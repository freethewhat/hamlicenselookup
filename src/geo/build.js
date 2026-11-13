import { openSync, readSync, closeSync, createWriteStream, existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename as fsRename, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { readZipEntries } from '../fcc/unzip.js';
import { download, runLockedJob } from '../update/run.js';
import { createProgressSink } from '../update/status.js';
import { STATES, STATE_BY_FIPS, STATE_BY_ABBR } from './fips.js';

export const GEO_SCHEMA_VERSION = 1;

const ZCTA_URL = 'https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip';
// 2020 county shapes, to match the 2020 relationship file (the 2024 file has Connecticut planning regions).
const COUNTY_URL = 'https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_county_500k.zip';
const REL_URL = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt';
const GEONAMES_URL = 'https://download.geonames.org/export/zip/US.zip';

// 10% keeps the largest state's zips.geojson (TX) at about 1.3 MB, well under the 4 MB target.
const SIMPLIFY = '10%';


// Reads a text file in 64 KB chunks and yields its lines, so no whole file is held in memory.
function* readLines(path) {
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(65536);
  const decoder = new StringDecoder('utf8');
  let carry = '';
  let first = true;
  const clean = (line) => {
    const s = first ? line.replace(/^\uFEFF/, '') : line;
    first = false;
    return s.replace(/\r$/, '');
  };
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const parts = (carry + decoder.write(buf.subarray(0, n))).split('\n');
      carry = parts.pop();
      for (const p of parts) yield clean(p);
    }
    carry += decoder.end();
    if (carry) yield clean(carry);
  } finally {
    closeSync(fd);
  }
}

const GEO_SCHEMA = `
CREATE TABLE states (abbr TEXT PRIMARY KEY, name TEXT, fips TEXT);
CREATE TABLE counties (geoid TEXT PRIMARY KEY, name TEXT, state TEXT);
CREATE TABLE zips (zip TEXT PRIMARY KEY, state TEXT, county_geoid TEXT, has_shape INTEGER, source TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`;

// Largest-land county per ZCTA, from the pipe-delimited Census relationship file.
function readZctaCounties(relPath) {
  const best = new Map();
  let cols = null;
  for (const line of readLines(relPath)) {
    if (!line) continue;
    const f = line.split('|');
    if (!cols) {
      cols = { zcta: f.indexOf('GEOID_ZCTA5_20'), county: f.indexOf('GEOID_COUNTY_20'), area: f.indexOf('AREALAND_PART') };
      continue;
    }
    const zcta = f[cols.zcta];
    if (!zcta) continue;
    const area = Number(f[cols.area]) || 0;
    const cur = best.get(zcta);
    if (!cur || area > cur.area) best.set(zcta, { geoid: f[cols.county], area });
  }
  return best;
}

export function buildGeoDb({ relPath, geonamesPath, countyNames, outDbPath }) {
  if (existsSync(outDbPath)) rmSync(outDbPath);
  const db = new Database(outDbPath);
  try {
    db.exec(GEO_SCHEMA);
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(GEO_SCHEMA_VERSION));
    const insState = db.prepare('INSERT INTO states (abbr, name, fips) VALUES (?, ?, ?)');
    const insCounty = db.prepare('INSERT INTO counties (geoid, name, state) VALUES (?, ?, ?)');
    const insZip = db.prepare('INSERT OR IGNORE INTO zips (zip, state, county_geoid, has_shape, source) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => {
      for (const s of STATES) insState.run(s.abbr, s.name, s.fips);
      for (const [geoid, c] of countyNames) insCounty.run(geoid, c.name, c.state);
      for (const [zcta, { geoid }] of readZctaCounties(relPath)) {
        const known = countyNames.has(geoid);
        insZip.run(zcta, STATE_BY_FIPS.get(geoid.slice(0, 2))?.abbr ?? null, known ? geoid : null, 1, 'zcta');
      }
      for (const line of readLines(geonamesPath)) {
        const f = line.split('\t');
        const zip = f[1];
        if (!/^\d{5}$/.test(zip)) continue;
        const stateFips = STATE_BY_ABBR.get(f[4])?.fips;
        const geoid = stateFips && /^\d{3}$/.test(f[6] ?? '') ? stateFips + f[6] : null;
        insZip.run(zip, f[4] || null, geoid && countyNames.has(geoid) ? geoid : null, 0, 'geonames');
      }
    })();
    const zipCount = db.prepare('SELECT COUNT(*) AS n FROM zips').get().n;
    const unassigned = db.prepare('SELECT COUNT(*) AS n FROM zips WHERE county_geoid IS NULL').get().n;
    return { zipCount, unassigned };
  } finally {
    db.close();
  }
}

async function extractEntries(zipPath, names, destDir) {
  await mkdir(destDir, { recursive: true });
  const entries = await readZipEntries(zipPath, names);
  try {
    for (const name of names) {
      const open = entries.get(name);
      if (!open) {
        if (name.endsWith('.shp') || name.endsWith('.dbf') || name === 'US.txt') throw new Error(`${name} not found in ${zipPath}`);
        continue;
      }
      await pipeline(await open(), createWriteStream(join(destDir, name)));
    }
  } finally {
    entries.close();
  }
}

const shapefileNames = (base) => ['shp', 'dbf', 'shx', 'prj', 'cpg'].map((e) => `${base}.${e}`);

// Moves mapshaper's per-state output (<ST>.json) into <geoDir>/<ST>/<name>.geojson.
async function placeStateFiles(srcDir, geoDir, name) {
  for (const s of STATES) {
    const src = join(srcDir, `${s.abbr}.json`);
    if (!existsSync(src)) continue;
    await mkdir(join(geoDir, s.abbr), { recursive: true });
    await fsRename(src, join(geoDir, s.abbr, `${name}.geojson`));
  }
}

/**
 * Replaces dataDir/geo and dataDir/geo.db with the new ones. The old copies are kept as
 * *.old until both new ones are in place; if anything fails they are put back.
 */
export async function swapGeo({ dataDir, newGeoDir, newDbPath, rename = fsRename }) {
  const geo = join(dataDir, 'geo');
  const db = join(dataDir, 'geo.db');
  const moved = []; // originals now sitting at <path>.old
  const installed = []; // paths now holding new data
  try {
    for (const p of [geo, db]) {
      if (existsSync(p)) {
        await rm(`${p}.old`, { recursive: true, force: true });
        await rename(p, `${p}.old`);
        moved.push(p);
      }
    }
    await rename(newGeoDir, geo);
    installed.push(geo);
    await rename(newDbPath, db);
    installed.push(db);
  } catch (err) {
    // Remove only what new data replaced; originals still in place are left alone.
    for (const p of installed) await rm(p, { recursive: true, force: true }).catch(() => {});
    for (const p of moved) await fsRename(`${p}.old`, p).catch(() => {});
    throw err;
  }
  for (const p of [geo, db]) await rm(`${p}.old`, { recursive: true, force: true });
}

// Holds the shared update lock so a geo build cannot run alongside a weekly or daily load.
export async function buildGeo({ dataDir, fetchImpl = fetch, onProgress }) {
  await runLockedJob(dataDir, 'geo', (status) => {
    const sink = createProgressSink(status);
    return buildGeoUnlocked({ dataDir, fetchImpl, onProgress: onProgress ? (...a) => { sink(...a); onProgress(...a); } : sink });
  }, () => 'Map data built');
}

/** Like buildGeo but the caller already holds the update lock. onProgress(step, done, total, label). */
export async function buildGeoUnlocked({ dataDir, fetchImpl = fetch, onProgress = () => {} }) {
  const mapshaper = createRequire(import.meta.url)('mapshaper');
  const tmp = join(dataDir, 'tmp-geo');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  let downloaded = 0;
  const dl = async (url, name) => {
    const label = `Downloading map sources (${++downloaded} of 4)`;
    await download(fetchImpl, url, join(tmp, name), { onProgress: (d, t) => onProgress('download', d, t, label) });
    return join(tmp, name);
  };

  console.log('Downloading Census and GeoNames sources...');
  const zctaZip = await dl(ZCTA_URL, 'zcta.zip');
  const countyZip = await dl(COUNTY_URL, 'county.zip');
  const relPath = await dl(REL_URL, 'rel.txt');
  const geoZip = await dl(GEONAMES_URL, 'geonames.zip');

  const countyBase = 'cb_2020_us_county_500k';
  const zctaBase = 'cb_2020_us_zcta520_500k';
  await extractEntries(countyZip, shapefileNames(countyBase), join(tmp, 'county'));
  await extractEntries(zctaZip, shapefileNames(zctaBase), join(tmp, 'zcta'));
  await extractEntries(geoZip, ['US.txt'], tmp);
  const geonamesPath = join(tmp, 'US.txt');

  const newGeo = join(tmp, 'geo-new');
  const countyOut = join(tmp, 'county-out');
  const zctaOut = join(tmp, 'zcta-out');
  const namesPath = join(tmp, 'county-names.json');
  await mkdir(countyOut, { recursive: true });
  await mkdir(zctaOut, { recursive: true });

  console.log('Simplifying county shapes...');
  onProgress('geo', null, null, 'Simplifying county shapes');
  await mapshaper.runCommands([
    '-i', join(tmp, 'county', `${countyBase}.shp`),
    '-each', 'geoid=GEOID, name=NAME, st=STUSPS',
    '-filter-fields', 'geoid,name,st',
    '-o', namesPath, 'format=json',
    '-simplify', SIMPLIFY, 'keep-shapes',
    '-split', 'st',
    '-filter-fields', 'geoid,name', 'target=*',
    '-o', countyOut, 'format=geojson', 'precision=0.0001',
  ]);
  const countyNames = new Map();
  for (const r of JSON.parse(await readFile(namesPath, 'utf8'))) {
    if (STATE_BY_ABBR.has(r.st)) countyNames.set(r.geoid, { name: r.name, state: r.st });
  }

  console.log('Building geo.db...');
  onProgress('geo', null, null, 'Building ZIP and county tables');
  const tmpDb = join(tmp, 'geo.db');
  const { zipCount, unassigned } = buildGeoDb({ relPath, geonamesPath, countyNames, outDbPath: tmpDb });

  // Join state onto ZCTA shapes via a ZIP-to-state CSV taken from geo.db.
  const db = new Database(tmpDb, { readonly: true });
  const rows = db.prepare('SELECT zip, state FROM zips WHERE has_shape = 1 AND state IS NOT NULL').all();
  db.close();
  const csvPath = join(tmp, 'zip-state.csv');
  await writeFile(csvPath, `zip,st\n${rows.map((r) => `${r.zip},${r.state}`).join('\n')}\n`);

  console.log('Simplifying ZIP shapes...');
  onProgress('geo', null, null, 'Simplifying ZIP shapes');
  await mapshaper.runCommands([
    '-i', join(tmp, 'zcta', `${zctaBase}.shp`),
    '-join', csvPath, 'keys=ZCTA5CE20,zip', 'field-types=zip:str',
    '-filter', 'st != null',
    '-each', 'zip=ZCTA5CE20',
    '-filter-fields', 'zip,st',
    '-simplify', SIMPLIFY, 'keep-shapes',
    '-split', 'st',
    '-filter-fields', 'zip', 'target=*',
    '-o', zctaOut, 'format=geojson', 'precision=0.0001',
  ]);

  await mkdir(newGeo, { recursive: true });
  await placeStateFiles(countyOut, newGeo, 'counties');
  await placeStateFiles(zctaOut, newGeo, 'zips');

  onProgress('swap', null, null, 'Installing the new map data');
  await swapGeo({ dataDir, newGeoDir: newGeo, newDbPath: tmpDb });
  await rm(tmp, { recursive: true, force: true });
  console.log(`geo built: ${zipCount} ZIPs, ${unassigned} without a county`);
}
