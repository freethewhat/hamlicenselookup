import Database from 'better-sqlite3';
import { readZipEntries } from '../fcc/unzip.js';
import {
  REQUIRED, parseCountsDate, readText, createStage, loadStage, licenseInsertSql, reclassify,
} from './load-weekly.js';

const metaValue = (db, key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;

/**
 * Patches an existing licenses.db with an FCC daily zip, which carries the full record
 * set for each changed license. Skipped (nothing changed) when the file is not newer
 * than meta.daily_applied_through.
 */
export async function applyDaily(zipPath, dbPath) {
  const entries = await readZipEntries(zipPath, REQUIRED);
  let db;
  try {
    for (const name of REQUIRED) {
      if (!entries.has(name)) throw new Error(`Daily zip is missing ${name}`);
    }
    const fileDate = parseCountsDate(await readText(await entries.get('counts')()));

    db = new Database(dbPath);
    const appliedThrough = metaValue(db, 'daily_applied_through');
    if (appliedThrough && fileDate <= appliedThrough) return { changed: 0, fileDate, skipped: true };
    const states = (metaValue(db, 'load_states') ?? '').split(',').filter(Boolean);

    // The daily is small, so its stage lives in memory.
    db.exec("ATTACH DATABASE ':memory:' AS stage");
    createStage(db);
    await loadStage(db, entries, new Set(states), 'stage.hs');

    let changed = 0;
    db.transaction(() => {
      db.exec(`CREATE TEMP TABLE touched (usid INTEGER PRIMARY KEY);
        INSERT OR IGNORE INTO touched SELECT usid FROM stage.hd;
        INSERT OR IGNORE INTO touched SELECT usid FROM stage.en;
        INSERT OR IGNORE INTO touched SELECT usid FROM stage.am;
        INSERT OR IGNORE INTO touched SELECT usid FROM stage.hs;`);
      const usids = db.prepare('SELECT usid FROM touched').all().map((r) => r.usid);
      changed = usids.length;

      // Licenses sharing an FRN with a touched license (as it was before the patch) must be
      // recomputed too: the touched one may no longer shadow their first license date.
      const neighbours = db.prepare(`SELECT usid FROM licenses WHERE frn <> '' AND frn IN
        (SELECT frn FROM licenses WHERE usid IN (SELECT usid FROM touched))`).all()
        .map((r) => r.usid);

      db.exec(`DELETE FROM licenses WHERE usid IN (SELECT usid FROM touched);
        DELETE FROM history WHERE usid IN (SELECT usid FROM touched);
        ${licenseInsertSql(states.length > 0)};
        INSERT INTO history (usid, date, code) SELECT usid, date, code FROM stage.hs
          WHERE usid IN (SELECT usid FROM licenses);`);
      reclassify(db, [...usids, ...neighbours]);

      const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
      setMeta.run('license_count', String(db.prepare('SELECT count(*) n FROM licenses').get().n));
      setMeta.run('daily_applied_through', fileDate);
      setMeta.run('data_as_of', fileDate);
      db.exec('DROP TABLE temp.touched');
    })();
    return { changed, fileDate, skipped: false };
  } finally {
    if (db?.open) db.close();
    entries.close();
  }
}
