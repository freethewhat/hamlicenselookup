import Database from 'better-sqlite3';
import { rm } from 'node:fs/promises';
import { readZipEntries } from '../fcc/unzip.js';
import {
  readDatLines, parseEN, parseHD, parseAM, parseHS,
} from '../fcc/parse.js';
import { classifyLicense } from '../fcc/classify.js';
import { SCHEMA_SQL, INDEX_SQL, LICENSE_SCHEMA_VERSION } from './schema.js';

const BATCH = 10000;
const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** 'File Creation Date: Sun Nov  8 09:08:58 EST 2026' -> '2026-11-08' */
export function parseCountsDate(text) {
  const m = /File Creation Date:\s+\w+\s+(\w{3})\s+(\d{1,2})\s+[\d:]+\s+\w+\s+(\d{4})/.exec(text);
  if (!m || !MONTHS[m[1]]) throw new Error('Cannot find file creation date in counts file');
  return `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}`;
}

export async function readText(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).toString('latin1');
}

// Streams a .dat entry into a prepared insert, committing every BATCH rows.
async function streamInto(db, open, prefix, stmt, toParams) {
  let n = 0;
  db.exec('BEGIN');
  try {
    for await (const f of readDatLines(await open(), prefix)) {
      const params = toParams(f);
      if (!params) continue;
      stmt.run(params);
      if (++n % BATCH === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
    }
    db.exec('COMMIT');
  } catch (err) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

export const STAGE_SQL = `
  CREATE TABLE stage.en (usid INTEGER PRIMARY KEY, entity_name, first, mi, last, suffix,
    street, city, state, zip, zip5, po_box, frn, applicant_type);
  CREATE TABLE stage.hd (usid INTEGER PRIMARY KEY, call, status, service,
    grant_date, expired_date, cancel_date, last_action_date);
  CREATE TABLE stage.am (usid INTEGER PRIMARY KEY, op_class, trustee_call, prev_call, prev_class);
  CREATE TABLE stage.hs (usid INTEGER, date, code);`;

export function createStage(db) {
  db.exec(STAGE_SQL);
}

/**
 * Streams EN/HD/AM/HS from the zip entries into the stage tables (stage must be attached
 * and created). Event rows go to hsTable ('history' or 'stage.hs'). EN rows outside a
 * non-empty stateSet are dropped.
 */
export async function loadStage(db, entries, stateSet, hsTable) {
  await streamInto(db, entries.get('EN.dat'), 'EN',
    db.prepare('INSERT OR REPLACE INTO stage.en VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    (f) => {
      const e = parseEN(f);
      if (!e || (stateSet.size && !stateSet.has(e.state))) return null;
      return [e.usid, e.entityName, e.first, e.mi, e.last, e.suffix, e.street, e.city,
        e.state, e.zip, e.zip5, e.poBox, e.frn, e.applicantType];
    });
  await streamInto(db, entries.get('HD.dat'), 'HD',
    db.prepare('INSERT OR REPLACE INTO stage.hd VALUES (?,?,?,?,?,?,?,?)'),
    (f) => {
      const h = parseHD(f);
      return [h.usid, h.call.trim().toUpperCase(), h.status, h.service, h.grantDate,
        h.expiredDate, h.cancelDate, h.lastActionDate];
    });
  await streamInto(db, entries.get('AM.dat'), 'AM',
    db.prepare('INSERT OR REPLACE INTO stage.am VALUES (?,?,?,?,?)'),
    (f) => {
      const a = parseAM(f);
      return [a.usid, a.opClass, a.trusteeCall, a.prevCall, a.prevClass];
    });
  await streamInto(db, entries.get('HS.dat'), 'HS',
    db.prepare(`INSERT INTO ${hsTable} (usid, date, code) VALUES (?,?,?)`),
    (f) => {
      const h = parseHS(f);
      return h.date ? [h.usid, h.date, h.code] : null;
    });
}

/** HD drives; EN is an INNER JOIN when filtering by state, else LEFT JOIN. */
export function licenseInsertSql(filtered) {
  return `INSERT INTO licenses (usid, call, status, service, grant_date, expired_date, cancel_date,
        last_action_date, applicant_type, entity_name, first, mi, last, suffix, street, po_box,
        city, state, zip, zip5, frn, op_class, prev_call, prev_class, trustee_call)
      SELECT hd.usid, hd.call, hd.status, hd.service, hd.grant_date, hd.expired_date,
        hd.cancel_date, hd.last_action_date, en.applicant_type, en.entity_name, en.first,
        en.mi, en.last, en.suffix, en.street, en.po_box, en.city, en.state, en.zip,
        COALESCE(en.zip5, ''), COALESCE(en.frn, ''), COALESCE(am.op_class, ''),
        COALESCE(am.prev_call, ''), COALESCE(am.prev_class, ''), COALESCE(am.trustee_call, '')
      FROM stage.hd hd
      ${filtered ? 'JOIN' : 'LEFT JOIN'} stage.en en ON en.usid = hd.usid
      LEFT JOIN stage.am am ON am.usid = hd.usid
      ORDER BY hd.usid`;
}

// Page walkers: yield rows in order, fetching one page at a time.
function* pagedLicenses(db) {
  const page = db.prepare(`SELECT usid, op_class, prev_call, prev_class, grant_date, frn
    FROM licenses WHERE usid > ? ORDER BY usid LIMIT ${BATCH}`);
  let last = -Infinity;
  for (;;) {
    const rows = page.all(last);
    if (rows.length === 0) return;
    yield* rows;
    last = rows[rows.length - 1].usid;
  }
}

function* pagedHistory(db) {
  const page = db.prepare(`SELECT rowid AS rid, usid, date, code FROM history
    WHERE (usid, rowid) > (?, ?) ORDER BY usid, rowid LIMIT ${BATCH}`);
  let lastUsid = -Infinity;
  let lastRid = -Infinity;
  for (;;) {
    const rows = page.all(lastUsid, lastRid);
    if (rows.length === 0) return;
    yield* rows;
    ({ usid: lastUsid, rid: lastRid } = rows[rows.length - 1]);
  }
}

const FRN_PASS_WHERE = `first_license_date IS NOT NULL AND frn <> '' AND EXISTS (
  SELECT 1 FROM licenses o WHERE o.frn = licenses.frn AND o.usid <> licenses.usid
    AND o.earliest_event_date < licenses.first_license_date)`;

/**
 * Recomputes first_license_date, upgrade_date and earliest_event_date for the given
 * usids (all licenses when omitted), then clears first_license_date where another
 * license on the same FRN has an earlier event. With a usid list, the set is widened to
 * every license sharing an FRN with one of them, and the FRN pass covers those FRNs.
 */
export function reclassify(db, usids) {
  const update = db.prepare(`UPDATE licenses SET first_license_date = ?, upgrade_date = ?,
    earliest_event_date = ? WHERE usid = ?`);
  const write = (lic, history) => {
    const r = classifyLicense({
      opClass: lic.op_class ?? '',
      prevCall: lic.prev_call ?? '',
      prevClass: lic.prev_class ?? '',
      grantDate: lic.grant_date,
      history,
    });
    update.run(r.firstLicenseDate, r.upgradeDate, r.earliestEventDate, lic.usid);
  };

  if (usids === undefined) {
    // Ordered merge walk: licenses and history both ascend by usid.
    const hist = pagedHistory(db);
    let next = hist.next();
    db.exec('BEGIN');
    try {
      let n = 0;
      for (const lic of pagedLicenses(db)) {
        while (!next.done && next.value.usid < lic.usid) next = hist.next();
        const events = [];
        while (!next.done && next.value.usid === lic.usid) {
          events.push({ date: next.value.date, code: next.value.code });
          next = hist.next();
        }
        write(lic, events);
        if (++n % BATCH === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
      }
      db.exec('COMMIT');
    } catch (err) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw err;
    }
    db.exec(`UPDATE licenses SET first_license_date = NULL WHERE ${FRN_PASS_WHERE}`);
    return;
  }

  const getLic = db.prepare(`SELECT usid, op_class, prev_call, prev_class, grant_date, frn
    FROM licenses WHERE usid = ?`);
  const getHist = db.prepare('SELECT date, code FROM history WHERE usid = ?');
  const frnOf = db.prepare('SELECT frn FROM licenses WHERE usid = ?');
  const sameFrn = db.prepare('SELECT usid FROM licenses WHERE frn = ?');
  const clear = db.prepare(`UPDATE licenses SET first_license_date = NULL
    WHERE frn = ? AND ${FRN_PASS_WHERE}`);
  db.transaction(() => {
    // Every license sharing an affected FRN is recomputed, so first_license_date is
    // restored on those that an earlier same-FRN license no longer shadows.
    const frns = new Set();
    for (const usid of usids) {
      const row = frnOf.get(usid);
      if (row?.frn) frns.add(row.frn);
    }
    const all = new Set(usids);
    for (const frn of frns) for (const r of sameFrn.all(frn)) all.add(r.usid);
    for (const usid of all) {
      const lic = getLic.get(usid);
      if (lic) write(lic, getHist.all(usid));
    }
    for (const frn of frns) clear.run(frn);
  })();
}

async function removeDb(path) {
  await Promise.all(['', '-wal', '-shm', '-journal'].map((s) => rm(path + s, { force: true })));
}

export const REQUIRED = ['EN.dat', 'HD.dat', 'AM.dat', 'HS.dat', 'counts'];

/**
 * Builds a fresh licenses.db at outDbPath from an FCC weekly zip. Any file already at
 * outDbPath is replaced, so callers should build to a temp path and swap on success.
 */
export async function loadWeekly(zipPath, outDbPath, opts = {}) {
  const states = (opts.states ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const stagePath = `${outDbPath}.stage`;
  await removeDb(outDbPath);
  await removeDb(stagePath);

  const entries = await readZipEntries(zipPath, REQUIRED);
  let db;
  try {
    for (const name of REQUIRED) {
      if (!entries.has(name)) throw new Error(`Weekly zip is missing ${name}`);
    }
    const fileDate = parseCountsDate(await readText(await entries.get('counts')()));

    db = new Database(outDbPath);
    // The file is only swapped in after success, so durability during the build is moot.
    // Rollback journal (DELETE) is set once the build is finished: sidecar files belong to the
    // path, so a WAL-mode file swapped in by rename could replay a stale -wal.
    db.pragma('journal_mode = OFF');
    db.pragma('synchronous = OFF');
    db.pragma('cache_size = -200000');
    db.pragma('temp_store = FILE');
    db.exec(SCHEMA_SQL);
    db.exec(`ATTACH DATABASE '${stagePath.replace(/'/g, "''")}' AS stage`);
    createStage(db);
    await loadStage(db, entries, new Set(states), 'history');

    db.exec(`${licenseInsertSql(states.length > 0)};
      DETACH DATABASE stage;`);
    await removeDb(stagePath);

    // History for licenses that were dropped (no HD row, or filtered out by state).
    db.exec('DELETE FROM history WHERE usid NOT IN (SELECT usid FROM licenses)');
    db.exec(INDEX_SQL);
    reclassify(db);

    const licenseCount = db.prepare('SELECT count(*) AS n FROM licenses').get().n;
    const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    for (const [k, v] of [
      ['schema_version', String(LICENSE_SCHEMA_VERSION)],
      ['data_as_of', fileDate],
      ['weekly_file_date', fileDate],
      ['daily_applied_through', fileDate],
      ['license_count', String(licenseCount)],
      ['load_states', states.join(',')],
    ]) setMeta.run(k, v);

    db.pragma('journal_mode = DELETE');
    db.pragma('synchronous = NORMAL');
    db.close();
    db = null;
    return { licenseCount, fileDate };
  } finally {
    if (db?.open) db.close();
    entries.close();
    await removeDb(stagePath);
  }
}
