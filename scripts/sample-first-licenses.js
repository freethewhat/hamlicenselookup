import { resolve } from 'node:path';
import Database from 'better-sqlite3';

// Prints a random sample of recent first-license rows plus upgrade rows, for manual spot-checks.
// Usage: node scripts/sample-first-licenses.js [--state MT] [--n 20]
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const state = arg('state', 'MT').toUpperCase();
const n = Number(arg('n', 20));
const dataDir = resolve(process.env.DATA_DIR || './data');
const db = new Database(resolve(dataDir, 'licenses.db'), { readonly: true, fileMustExist: true });

const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
const cols = 'call, first_license_date, grant_date, prev_call, prev_class, upgrade_date';

const firsts = db.prepare(`SELECT ${cols}, 'first' AS kind FROM licenses
  WHERE state = ? AND first_license_date >= ? ORDER BY random() LIMIT ?`).all(state, since, n);
const upgrades = db.prepare(`SELECT ${cols}, 'upgrade' AS kind FROM licenses
  WHERE state = ? AND upgrade_date >= ? ORDER BY random() LIMIT 10`).all(state, since);

console.log('call, first_license_date, grant_date, prev_call, prev_class, flag');
for (const r of [...firsts, ...upgrades]) {
  console.log([r.call, r.first_license_date ?? '', r.grant_date, r.prev_call, r.prev_class,
    r.kind === 'upgrade' ? 'upgrade' : ''].join(', '));
}
db.close();
