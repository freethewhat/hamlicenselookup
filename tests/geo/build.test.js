import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildGeoDb, GEO_SCHEMA_VERSION } from '../../src/geo/build.js';

const HEADER = 'OID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|CLASSFP_ZCTA5_20|FUNCSTAT_ZCTA5_20|OID_COUNTY_20|GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|AREAWATER_COUNTY_20|MTFCC_COUNTY_20|CLASSFP_COUNTY_20|FUNCSTAT_COUNTY_20|AREALAND_PART|AREAWATER_PART';
const rel = (zcta, geoid, part) => ['1', zcta, '', '', '', '', '', '', '2', geoid, '', '', '', '', '', '', part, '0'].join('|');
const gn = (zip, st, county, fips) => ['US', zip, 'Town', 'Montana', st, county, fips, '', '', '1', '1', '1'].join('\t');

test('buildGeoDb picks the largest-land county and adds geonames-only zips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'geo-'));
  try {
    const relPath = join(dir, 'rel.txt');
    const geonamesPath = join(dir, 'US.txt');
    const relLines = [rel('59801', '30049', '100'), rel('59801', '30063', '900'), rel('', '30001', '5')];
    await writeFile(relPath, `\uFEFF${HEADER}\r\n${relLines.join('\r\n')}\r\n`);
    const gnLines = [gn('59801', 'MT', 'Missoula', '063'), gn('59806', 'MT', 'Missoula', '063'), gn('59999', 'MT', 'Nowhere', '999')];
    await writeFile(geonamesPath, `${gnLines.join('\n')}\n`);
    const countyNames = new Map([
      ['30049', { name: 'Lewis and Clark', state: 'MT' }], ['30063', { name: 'Missoula', state: 'MT' }],
    ]);
    const outDbPath = join(dir, 'geo.db');
    assert.deepEqual(buildGeoDb({ relPath, geonamesPath, countyNames, outDbPath }), { zipCount: 3, unassigned: 1 });

    const db = new Database(outDbPath, { readonly: true });
    const z = (zip) => db.prepare('SELECT * FROM zips WHERE zip = ?').get(zip);
    assert.deepEqual(z('59801'), { zip: '59801', state: 'MT', county_geoid: '30063', has_shape: 1, source: 'zcta' });
    assert.deepEqual(z('59806'), { zip: '59806', state: 'MT', county_geoid: '30063', has_shape: 0, source: 'geonames' });
    assert.equal(z('59999').county_geoid, null);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, String(GEO_SCHEMA_VERSION));
    assert.equal(db.prepare('SELECT name FROM counties WHERE geoid = ?').get('30063').name, 'Missoula');
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
