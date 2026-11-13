import Database from 'better-sqlite3';
import { createWriteStream, existsSync, renameSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { loadWeekly, parseCountsDate, readText } from '../db/load-weekly.js';
import { applyDaily } from '../db/apply-daily.js';
import { LICENSE_SCHEMA_VERSION } from '../db/schema.js';
import { readZipEntries } from '../fcc/unzip.js';
import { checkSchemas } from '../db/handle.js';
import { buildGeoUnlocked } from '../geo/build.js';
import { createStatusWriter, createProgressSink, nullStatus } from './status.js';

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

// Streams a URL to disk; never holds the body in memory. onProgress(done, total) gets bytes
// written so far; total is null when the server sends no Content-Length.
export async function download(fetchImpl, url, dest, { onProgress } = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(url, res.status);
  }
  const stages = [Readable.fromWeb(res.body)];
  if (onProgress) {
    const total = Number(res.headers.get('content-length')) || null;
    let done = 0;
    onProgress(0, total);
    stages.push(new Transform({
      transform(chunk, _enc, cb) {
        done += chunk.length;
        onProgress(done, total);
        cb(null, chunk);
      },
    }));
  }
  await pipeline(...stages, createWriteStream(dest));
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

/**
 * Takes an exclusive SQLite lock on dataDir/.update-lock.db. SQLite uses OS file locks, which
 * work across processes and containers sharing the mount and are released by the kernel if
 * the holder dies, so there is no stale-lock cleanup. The file itself is never deleted.
 */
export async function acquireUpdateLock(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, '.update-lock.db');
  const db = new Database(path);
  try {
    db.pragma('busy_timeout = 0');
    db.exec('BEGIN EXCLUSIVE');
  } catch (err) {
    db.close();
    if (err.code === 'SQLITE_BUSY') {
      throw Object.assign(new Error(`Another update is running (lock: ${path})`, { cause: err }), { code: 'UPDATE_LOCKED' });
    }
    throw err;
  }
  return {
    release() {
      if (!db.open) return;
      try {
        db.exec('ROLLBACK');
      } finally {
        db.close();
      }
    },
  };
}

/**
 * Runs fn(status) under the update lock with a status writer for `job`. describe(result)
 * gives the message for the final 'done' status. The status file is only touched once the
 * lock is held, so a run that loses the race never overwrites the owner's progress.
 */
export async function runLockedJob(dataDir, job, fn, describe = () => null) {
  const lock = await acquireUpdateLock(dataDir);
  try {
    const status = createStatusWriter(dataDir, job);
    try {
      const result = await fn(status);
      status.finish(describe(result));
      return result;
    } catch (err) {
      status.fail(err.message);
      throw err;
    }
  } finally {
    lock.release();
  }
}

/** Downloads the weekly file, builds a new db and swaps it in only if it looks sane. */
export async function runWeekly(opts) {
  return runLockedJob(opts.dataDir, 'weekly', (status) => runWeeklyUnlocked({ ...opts, status }),
    (r) => `Loaded ${r.licenseCount} licenses as of ${r.fileDate}`);
}

/** Like runWeekly but the caller already holds the update lock. */
export async function runWeeklyUnlocked({
  dataDir, url = WEEKLY_URL, fetchImpl = fetch, minRatio = 0.95, states = [], status = nullStatus,
}) {
  const progress = createProgressSink(status);
  const tmp = await prepareTmp(dataDir);
  try {
    const zipPath = join(tmp, 'l_amat.zip');
    const newDb = join(tmp, 'licenses-new.db');
    const liveDb = join(dataDir, 'licenses.db');
    await download(fetchImpl, url, zipPath, { onProgress: (d, t) => progress('download', d, t) });
    const result = await loadWeekly(zipPath, newDb, { states, onProgress: progress });

    if (existsSync(liveDb)) {
      const oldStates = readMeta(liveDb, 'load_states') ?? '';
      const oldCount = Number(readMeta(liveDb, 'license_count'));
      if (oldStates === readMeta(newDb, 'load_states') && result.licenseCount < minRatio * oldCount) {
        throw new Error(`License count dropped from ${oldCount} to ${result.licenseCount}; keeping old data`);
      }
    }

    status.step('swap', 'Switching to the new data');
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
export async function runDaily(opts) {
  return runLockedJob(opts.dataDir, 'daily', (status) => runDailyUnlocked({ ...opts, status }),
    (r) => `Applied ${r.applied.length} daily file(s)`);
}

/** Like runDaily but the caller already holds the update lock. */
export async function runDailyUnlocked({
  dataDir, baseUrl = DAILY_BASE_URL, fetchImpl = fetch, status = nullStatus,
}) {
  const progress = createProgressSink(status);
  const liveDb = join(dataDir, 'licenses.db');
  if (Number(readMeta(liveDb, 'schema_version')) !== LICENSE_SCHEMA_VERSION) {
    throw new Error('licenses.db schema is out of date; run the weekly load');
  }
  const tmp = await prepareTmp(dataDir);
  try {
    const files = [];
    for (const [i, day] of DAILY_DAYS.entries()) {
      const zipPath = join(tmp, `l_am_${day}.zip`);
      const label = `Downloading daily file (${i + 1} of ${DAILY_DAYS.length})`;
      try {
        await download(fetchImpl, `${baseUrl}/l_am_${day}.zip`, zipPath,
          { onProgress: (d, t) => progress('download', d, t, label) });
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
    for (const [i, f] of files.entries()) {
      const label = `Applying daily update (${i + 1} of ${files.length})`;
      const res = await applyDaily(f.zipPath, liveDb, { onProgress: (_s, d, t) => progress('daily', d, t, label) });
      if (!res.skipped) applied.push(res.fileDate);
    }
    return { applied };
  } finally {
    await emptyDir(tmp);
  }
}

const DAY_MS = 86_400_000;
const WEEKLY_MAX_AGE_DAYS = 7;

/**
 * The start-up update: builds missing or outdated map data, runs a weekly load when license
 * data is missing, outdated or its Sunday file is more than 7 days old, then applies the
 * daily files. Takes the update lock once for all of it; returns {actions: []} without
 * touching anything when another update holds the lock.
 */
export async function runAuto({
  dataDir, fetchImpl = fetch, now = new Date(), states = [], geoBuilder = buildGeoUnlocked,
}) {
  const actions = [];
  try {
    await runLockedJob(dataDir, 'auto', async (status) => {
      const schemas = checkSchemas(dataDir);
      if (schemas.geo !== 'ok') {
        actions.push('geo');
        await geoBuilder({ dataDir, fetchImpl, onProgress: createProgressSink(status) });
      }
      const weeklyDate = schemas.licenses === 'ok' ? readMeta(join(dataDir, 'licenses.db'), 'weekly_file_date') : null;
      const age = now - Date.parse(weeklyDate ?? '');
      if (!(age <= WEEKLY_MAX_AGE_DAYS * DAY_MS)) {
        actions.push('weekly');
        await runWeeklyUnlocked({ dataDir, fetchImpl, states, status });
      }
      actions.push('daily');
      await runDailyUnlocked({ dataDir, fetchImpl, status });
    }, () => `Update finished: ${actions.join(', ')}`);
  } catch (err) {
    if (err.code !== 'UPDATE_LOCKED') throw err;
    console.log('Another update is running; skipping start-up update.');
    return { actions: [] };
  }
  return { actions };
}
