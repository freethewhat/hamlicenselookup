import { existsSync, renameSync } from 'node:fs';
import Database from 'better-sqlite3';

export const GEOCODE_SCHEMA_VERSION = 1;

const NONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function storedVersion(path) {
  const db = new Database(path, { readonly: true, timeout: 10000 });
  try {
    const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
    if (!hasMeta) return null;
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    return row ? row.value : null;
  } finally {
    db.close();
  }
}

export function openPointStore(path, { now = () => new Date() } = {}) {
  if (existsSync(path)) {
    let version;
    try {
      version = storedVersion(path);
    } catch (err) {
      if (err.code !== 'SQLITE_NOTADB' && err.code !== 'SQLITE_CORRUPT') throw err;
      version = 'unreadable';
    }
    if (version !== null && version !== String(GEOCODE_SCHEMA_VERSION)) {
      const aside = `${path}.old-${now().toISOString().replace(/[:.]/g, '-')}`;
      renameSync(path, aside);
      for (const ext of ['-wal', '-shm']) {
        if (existsSync(path + ext)) renameSync(path + ext, aside + ext);
      }
    }
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS points (
      addr_key TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      lat REAL, lon REAL,
      checked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS points_latlon ON points(lat, lon);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
    .run('schema_version', String(GEOCODE_SCHEMA_VERSION));

  const lookupStmt = db.prepare(
    `SELECT addr_key, status, lat, lon, checked_at FROM points
     WHERE addr_key IN (SELECT value FROM json_each(?))`,
  );
  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO points (addr_key, status, lat, lon, checked_at) VALUES (?, ?, ?, ?, ?)',
  );
  const saveAll = db.transaction((results, day) => {
    for (const r of results) insertStmt.run(r.key, r.status, r.lat ?? null, r.lon ?? null, day);
  });

  return {
    lookup(keys) {
      const out = new Map();
      if (!keys.length) return out;
      const cutoff = now().getTime() - NONE_MAX_AGE_MS;
      for (const r of lookupStmt.all(JSON.stringify(keys))) {
        const stale = r.status === 'none' && Date.parse(r.checked_at) < cutoff;
        out.set(r.addr_key, { status: r.status, lat: r.lat, lon: r.lon, fresh: !stale });
      }
      return out;
    },
    save(results) {
      saveAll(results, now().toISOString().slice(0, 10));
    },
    close() {
      db.close();
    },
  };
}
