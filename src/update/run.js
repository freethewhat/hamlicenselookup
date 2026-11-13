import Database from 'better-sqlite3';
import { createWriteStream, existsSync, renameSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadWeekly, parseCountsDate, readText } from '../db/load-weekly.js';
import { applyDaily } from '../db/apply-daily.js';
import { LICENSE_SCHEMA_VERSION } from '../db/schema.js';
import { readZipEntries } from '../fcc/unzip.js';

export const DAILY_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKLY_URL = 'https://data.fcc.gov/download/pub/uls/complete/l_amat.zip';
const DAILY_BASE_URL = 'https://data.fcc.gov/download/pub/uls/daily';
const USER_AGENT = 'ham-license-finder';

class HttpError extends Error {
  constructor(url, status) {
    super(`Download of ${url} failed with HTTP ${status}`);
    this.status = status;
  }
}

// Streams a URL to disk; never holds the body in memory.
async function download(fetchImpl, url, dest) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(url, res.status);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function prepareTmp(dataDir) {
  const tmp = join(dataDir, 'tmp');
  await mkdir(tmp, { recursive: true });
  await emptyDir(tmp);
  return tmp;
}

async function emptyDir(dir) {
  for (const name of await readdir(dir)) await rm(join(dir, name), { recursive: true, force: true });
}

function readMeta(dbPath, key) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
  } finally {
    db.close();
  }
}

/** Downloads the weekly file, builds a new db and swaps it in only if it looks sane. */
export async function runWeekly({
  dataDir, url = WEEKLY_URL, fetchImpl = fetch, minRatio = 0.95, states = [],
}) {
  const tmp = await prepareTmp(dataDir);
  try {
    const zipPath = join(tmp, 'l_amat.zip');
    const newDb = join(tmp, 'licenses-new.db');
    const liveDb = join(dataDir, 'licenses.db');
    await download(fetchImpl, url, zipPath);
    const result = await loadWeekly(zipPath, newDb, { states });

    if (existsSync(liveDb)) {
      const oldStates = readMeta(liveDb, 'load_states') ?? '';
      const oldCount = Number(readMeta(liveDb, 'license_count'));
      if (oldStates === readMeta(newDb, 'load_states') && result.licenseCount < minRatio * oldCount) {
        throw new Error(`License count dropped from ${oldCount} to ${result.licenseCount}; keeping old data`);
      }
    }

    // loadWeekly closed the db in DELETE journal mode, so no sidecars may remain.
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (existsSync(newDb + suffix)) throw new Error(`Unexpected ${newDb}${suffix} after build`);
    }
    renameSync(newDb, liveDb);
    // Sidecars belong to the path: drop any left by an older WAL-mode file so they are
    // never replayed into the new one.
    await Promise.all(['-wal', '-shm'].map((s) => rm(liveDb + s, { force: true })));
    return result;
  } finally {
    await emptyDir(tmp);
  }
}

/** Downloads the seven daily files and applies them oldest first. */
export async function runDaily({ dataDir, baseUrl = DAILY_BASE_URL, fetchImpl = fetch }) {
  const liveDb = join(dataDir, 'licenses.db');
  if (Number(readMeta(liveDb, 'schema_version')) !== LICENSE_SCHEMA_VERSION) {
    throw new Error('licenses.db schema is out of date; run the weekly load');
  }
  const tmp = await prepareTmp(dataDir);
  try {
    const files = [];
    for (const day of DAILY_DAYS) {
      const zipPath = join(tmp, `l_am_${day}.zip`);
      try {
        await download(fetchImpl, `${baseUrl}/l_am_${day}.zip`, zipPath);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) continue;
        throw err;
      }
      const entries = await readZipEntries(zipPath, ['counts']);
      try {
        if (!entries.has('counts')) throw new Error(`Daily zip for ${day} is missing counts`);
        files.push({ zipPath, fileDate: parseCountsDate(await readText(await entries.get('counts')())) });
      } finally {
        entries.close();
      }
    }
    files.sort((a, b) => a.fileDate.localeCompare(b.fileDate));

    const applied = [];
    for (const f of files) {
      const res = await applyDaily(f.zipPath, liveDb);
      if (!res.skipped) applied.push(res.fileDate);
    }
    return { applied };
  } finally {
    await emptyDir(tmp);
  }
}
