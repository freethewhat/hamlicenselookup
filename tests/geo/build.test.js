import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile, rename, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildGeo, buildGeoDb, swapGeo, GEO_SCHEMA_VERSION } from '../../src/geo/build.js';

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

const exists = (p) => access(p).then(() => true, () => false);

for (const failAt of [1, 2, 3, 4]) {
test(`swapGeo restores the original geo.db and geo/ when rename ${failAt} fails`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'swap-'));
  try {
    await mkdir(join(dir, 'geo', 'MT'), { recursive: true });
    await writeFile(join(dir, 'geo', 'MT', 'zips.geojson'), 'old');
    await writeFile(join(dir, 'geo.db'), 'old-db');
    await mkdir(join(dir, 'new-geo'), { recursive: true });
    await writeFile(join(dir, 'new-geo', 'x'), 'new');
    await writeFile(join(dir, 'new.db'), 'new-db');
    let calls = 0;
    const flaky = (a, b) => {
      if (++calls === failAt) throw new Error('disk full');
      return rename(a, b);
    };
    await assert.rejects(
      swapGeo({ dataDir: dir, newGeoDir: join(dir, 'new-geo'), newDbPath: join(dir, 'new.db'), rename: flaky }),
      /disk full/,
    );
    assert.equal(await readFile(join(dir, 'geo.db'), 'utf8'), 'old-db');
    assert.equal(await readFile(join(dir, 'geo', 'MT', 'zips.geojson'), 'utf8'), 'old');
    assert.equal(await exists(join(dir, 'geo.db.old')), false);
    assert.equal(await exists(join(dir, 'geo.old')), false);

    await mkdir(join(dir, 'new-geo'), { recursive: true });
    await writeFile(join(dir, 'new-geo', 'x'), 'new');
    await writeFile(join(dir, 'new.db'), 'new-db');
    await swapGeo({ dataDir: dir, newGeoDir: join(dir, 'new-geo'), newDbPath: join(dir, 'new.db') });
    assert.equal(await readFile(join(dir, 'geo.db'), 'utf8'), 'new-db');
    assert.equal(await readFile(join(dir, 'geo', 'x'), 'utf8'), 'new');
    assert.equal(await exists(join(dir, 'geo.old')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
}

test('buildGeo refuses to run while the update lock is held and leaves tmp alone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lock-'));
  const lockUrl = new URL('../../src/update/run.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    const { acquireUpdateLock } = await import(${JSON.stringify(lockUrl)});
    await acquireUpdateLock(${JSON.stringify(dir)});
    console.log('ready');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await once(child.stdout, 'data');
    await mkdir(join(dir, 'tmp'));
    await writeFile(join(dir, 'tmp', 'weekly.zip'), 'partial');
    const noNet = () => { throw new Error('network must not be touched'); };
    await assert.rejects(buildGeo({ dataDir: dir, fetchImpl: noNet }), /Another update is running/);
    assert.equal(await readFile(join(dir, 'tmp', 'weekly.zip'), 'utf8'), 'partial');
  } finally {
    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
    await rm(dir, { recursive: true, force: true });
  }
});
