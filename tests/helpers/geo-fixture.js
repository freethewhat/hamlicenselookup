import Database from 'better-sqlite3';
import { GEO_SCHEMA_VERSION } from '../../src/geo/build.js';
import { STATES } from '../../src/geo/fips.js';

// counties: [{geoid, name, state}], zips: [{zip, county_geoid, state?, has_shape?, source?}]
export function makeGeoDb(path, { counties = [], zips = [] } = {}) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE states (abbr TEXT PRIMARY KEY, name TEXT, fips TEXT);
    CREATE TABLE counties (geoid TEXT PRIMARY KEY, name TEXT, state TEXT);
    CREATE TABLE zips (zip TEXT PRIMARY KEY, state TEXT, county_geoid TEXT, has_shape INTEGER, source TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);`);
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('schema_version', String(GEO_SCHEMA_VERSION));
  const used = new Set([...counties.map((c) => c.state), ...zips.map((z) => z.state).filter(Boolean)]);
  const insState = db.prepare('INSERT INTO states VALUES (?, ?, ?)');
  for (const s of STATES) if (used.has(s.abbr)) insState.run(s.abbr, s.name, s.fips);
  const insCounty = db.prepare('INSERT INTO counties VALUES (?, ?, ?)');
  for (const c of counties) insCounty.run(c.geoid, c.name, c.state);
  const insZip = db.prepare('INSERT INTO zips VALUES (?, ?, ?, ?, ?)');
  for (const z of zips) {
    insZip.run(z.zip, z.state ?? null, z.county_geoid ?? null, z.has_shape ?? 1, z.source ?? 'zcta');
  }
  db.close();
}
