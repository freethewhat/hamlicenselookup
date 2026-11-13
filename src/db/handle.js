import { statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { LICENSE_SCHEMA_VERSION } from './schema.js';
import { GEO_SCHEMA_VERSION } from '../geo/build.js';

// Old connections may still be streaming a CSV when a file is swapped, so they close late.
const CLOSE_GRACE_MS = 10 * 60 * 1000;
// A connection with an open iterator cannot close yet; try again this often.
const BUSY_RETRY_MS = 30 * 1000;

const isBusy = (err) => /busy executing a query/.test(err?.message ?? '');

function schemaState(path, expected) {
  if (!existsSync(path)) return 'missing';
  let db;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    return row && Number(row.value) === expected ? 'ok' : 'outdated';
  } catch (err) {
    // A missing meta table is a real layout mismatch; any other open/read error is
    // treated as transient so the handle retries.
    return /no such table/.test(err.message) ? 'outdated' : 'missing';
  } finally {
    db?.close();
  }
}

export function checkSchemas(dataDir) {
  return {
    licenses: schemaState(join(dataDir, 'licenses.db'), LICENSE_SCHEMA_VERSION),
    geo: schemaState(join(dataDir, 'geo.db'), GEO_SCHEMA_VERSION),
  };
}

const inode = (p) => {
  try {
    const s = statSync(p);
    return `${s.dev}:${s.ino}`;
  } catch {
    return null;
  }
};

// Read-only handle on licenses.db with geo.db attached as `geo`. Both files are replaced by
// atomic rename, so we re-stat them and reopen when either inode changes.
export function openHandle({
  licenseDbPath, geoDbPath, recheckMs = 5000, closeGraceMs = CLOSE_GRACE_MS, busyRetryMs = BUSY_RETRY_MS,
}) {
  let db = null;
  let state = 'missing';
  let ids = null;
  let checkedAt = -Infinity;
  const retired = new Set();

  // A request may still be streaming from the old connection, so close it late.
  // better-sqlite3 refuses to close while an iterator is open (a stalled export), so retry later.
  const retire = (old, delay = closeGraceMs) => {
    if (!old) return;
    const entry = { old };
    entry.timer = setTimeout(() => {
      retired.delete(entry);
      try {
        if (old.open) old.close();
      } catch (err) {
        if (!isBusy(err)) throw err;
        retire(old, busyRetryMs);
      }
    }, delay);
    entry.timer.unref();
    retired.add(entry);
  };
  // On shutdown a busy connection is left for process exit to clean up.
  const closeQuietly = (conn) => {
    try {
      if (conn?.open) conn.close();
    } catch (err) {
      if (!isBusy(err)) throw err;
    }
  };

  function reopen() {
    retire(db);
    db = null;
    const lic = schemaState(licenseDbPath, LICENSE_SCHEMA_VERSION);
    const geo = schemaState(geoDbPath, GEO_SCHEMA_VERSION);
    if (lic === 'missing' || geo === 'missing') state = 'missing';
    else state = lic === 'ok' && geo === 'ok' ? 'ok' : 'outdated';
    if (state !== 'ok') return;
    try {
      db = new Database(licenseDbPath, { readonly: true, fileMustExist: true });
      db.prepare('ATTACH DATABASE ? AS geo').run(resolve(geoDbPath)); // inherits the read-only flag (URI ?mode=ro is not enabled in this build)
    } catch {
      db?.close();
      db = null;
      state = 'missing';
    }
  }

  function refresh() {
    const now = Date.now();
    if (now - checkedAt < recheckMs) return;
    checkedAt = now;
    const next = `${inode(licenseDbPath)}|${inode(geoDbPath)}`;
    if (next === ids) return;
    ids = next;
    reopen();
    // Unchanged inodes would never retry a failed open, so force a retry next recheck.
    if (state !== 'ok') ids = null;
  }

  return {
    get() {
      refresh();
      return state === 'ok' ? db : null;
    },
    status() {
      refresh();
      return state;
    },
    close() {
      for (const { timer, old } of retired) {
        clearTimeout(timer);
        closeQuietly(old);
      }
      retired.clear();
      closeQuietly(db);
      db = null;
      state = 'missing';
    },
  };
}
