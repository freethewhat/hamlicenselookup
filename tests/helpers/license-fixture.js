import Database from 'better-sqlite3';
import { SCHEMA_SQL, INDEX_SQL, LICENSE_SCHEMA_VERSION } from '../../src/db/schema.js';
import { nameKey } from '../../src/db/name-key.js';

// Three active individual licensees in Missoula ZIPs, with no address beyond the ZIP.
export const LICENSE_ROWS = [
  { usid: 1, call: 'K7AAA', last: 'TESTER', first: 'ALPHA', zip: '59801', zip5: '59801', first_license_date: '2026-05-01', op_class: 'T' },
  { usid: 2, call: 'K7BBB', last: 'TESTER', first: 'BETA', zip: '59801', zip5: '59801', first_license_date: '2016-03-02', op_class: 'G' },
  { usid: 3, call: 'K7CCC', last: 'TESTER', first: 'GAMMA', zip: '59806', zip5: '59806', first_license_date: '2016-03-02', op_class: 'G' },
];

// Rows are objects keyed by license column; status 'A', applicant_type 'I', trustee_call '' by default.
export function makeLicenseDb(
  path,
  { rows = LICENSE_ROWS, version = LICENSE_SCHEMA_VERSION, asOf = '2026-11-10', count = rows.length } = {},
) {
  const db = new Database(path);
  db.exec(SCHEMA_SQL + INDEX_SQL);
  const meta = db.prepare('INSERT INTO meta VALUES (?, ?)');
  meta.run('schema_version', String(version));
  meta.run('data_as_of', asOf);
  meta.run('license_count', String(count));
  for (const r of rows) {
    const row = { status: 'A', applicant_type: 'I', trustee_call: '', ...r, last_key: nameKey(r.last) };
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO licenses (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
  }
  db.close();
}
