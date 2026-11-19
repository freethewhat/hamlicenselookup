// Finds licenses for the lookup page by one field: call, name, street, city, county, or ZIP.
// Inputs are already checked by parseLookup in src/server/app.js. db has geo.db attached as `geo`.
import { nameKey } from '../db/name-key.js';
import { resolveZips } from './resolve.js';

export const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

// "Starts with" on last_key. Keys hold only A-Z and 0-9, and '[' sorts right after 'Z'.
const keyPrefix = (name) => `(l.last_key >= @${name} AND l.last_key < @${name} || '[')`;

function where(db, { by, q = '', state = '', county = '' }) {
  switch (by) {
    case 'call':
      return { sql: 'l.call = @q', params: { q } };
    case 'name': {
      const text = q.trim();
      const words = text.split(/\s+/);
      const params = { whole: nameKey(text), ent: `${escapeLike(text)}%` };
      const terms = [keyPrefix('whole')];
      if (words.length > 1) {
        params.first = `${escapeLike(words[0])}%`;
        params.rest = nameKey(words.slice(1).join(''));
        terms.push(`(l.first LIKE @first ESCAPE '\\' AND ${keyPrefix('rest')})`);
      }
      terms.push("(l.applicant_type <> 'I' AND l.entity_name LIKE @ent ESCAPE '\\')");
      return { sql: `(${terms.join(' OR ')})`, params };
    }
    case 'street':
      return {
        sql: "(l.street LIKE @c ESCAPE '\\' OR l.po_box LIKE @c ESCAPE '\\')",
        params: { c: `%${escapeLike(q)}%` },
      };
    case 'city':
      return { sql: 'l.city = @q COLLATE NOCASE AND l.state = @state', params: { q, state } };
    case 'zip':
      return { sql: 'l.zip5 = @q', params: { q } };
    case 'county':
      return {
        sql: 'l.zip5 IN (SELECT value FROM json_each(@zips))',
        params: { zips: JSON.stringify(resolveZips(db, { counties: [county] }).zips) },
      };
    default:
      throw new Error(`Unknown lookup field: ${by}`);
  }
}

// The rows and count queries. Exported so tests can check the query plan.
export function lookupSql(db, p, limit = 100) {
  const w = where(db, p);
  const countSql = `SELECT COUNT(*) AS n FROM licenses l WHERE ${w.sql}`;
  const sql = `SELECT l.*, c.name AS county_name FROM licenses l
    LEFT JOIN geo.zips z ON z.zip = l.zip5
    LEFT JOIN geo.counties c ON c.geoid = z.county_geoid
    WHERE ${w.sql}
    ORDER BY CASE WHEN l.status = 'A' THEN 0 ELSE 1 END,
      CASE WHEN l.last_key <> '' THEN l.last_key ELSE upper(l.entity_name) END,
      l.first COLLATE NOCASE, l.call
    LIMIT ${Math.trunc(limit)}`;
  return { sql, countSql, params: w.params };
}

export function lookup(db, p, limit = 100) {
  const { sql, countSql, params } = lookupSql(db, p, limit);
  return { count: db.prepare(countSql).get(params).n, rows: db.prepare(sql).all(params) };
}
