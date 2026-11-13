import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { resolveZips } from '../../src/search/resolve.js';
import { makeGeoDb } from '../helpers/geo-fixture.js';

test('resolveZips includes geonames-only zips and dedupes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'resolve-'));
  try {
    const path = join(dir, 'geo.db');
    makeGeoDb(path, {
      counties: [{ geoid: '30063', name: 'Missoula', state: 'MT' }],
      zips: [
        { zip: '59801', state: 'MT', county_geoid: '30063' },
        { zip: '59806', state: 'MT', county_geoid: '30063', has_shape: 0, source: 'geonames' },
      ],
    });
    const db = new Database(path, { readonly: true });
    const r = resolveZips(db, { counties: ['30063'], zips: ['59801', '59806', 'abc'] });
    assert.deepEqual(r, { zips: ['59801', '59806'], invalid: ['abc'] });
    assert.deepEqual(resolveZips(db, { zips: ['12345'] }).zips, ['12345']);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
