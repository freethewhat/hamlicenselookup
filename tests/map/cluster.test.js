import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterPoints } from '../../src/map/cluster.js';

const hams = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

test('two points 10 m apart at zoom 10 form one cluster with summed count', () => {
  const pts = [
    { lat: 46.87, lon: -113.99, hams: hams(2) },
    { lat: 46.87009, lon: -113.99, hams: hams(3) },
  ];
  const out = clusterPoints(pts, { zoom: 10 });
  assert.equal(out.pins.length, 0);
  assert.equal(out.clusters.length, 1);
  assert.equal(out.clusters[0].count, 5);
});

test('the same two points at zoom 16 are two pins', () => {
  const pts = [
    { lat: 46.87, lon: -113.99, hams: hams(2) },
    { lat: 46.87009, lon: -113.99, hams: hams(3) },
  ];
  const out = clusterPoints(pts, { zoom: 16 });
  assert.equal(out.clusters.length, 0);
  assert.equal(out.pins.length, 2);
});

test('two points 50 km apart at zoom 10 are two pins', () => {
  const pts = [
    { lat: 46.87, lon: -113.99, hams: hams(1) },
    { lat: 46.87, lon: -113.99 + 0.65, hams: hams(1) },
  ];
  const out = clusterPoints(pts, { zoom: 10 });
  assert.equal(out.clusters.length, 0);
  assert.equal(out.pins.length, 2);
});

test('10,000 points at zoom 4 stay within maxItems and keep every ham', () => {
  let s = 12345;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const pts = [];
  let total = 0;
  for (let i = 0; i < 10000; i++) {
    const n = 1 + Math.floor(rand() * 3);
    total += n;
    pts.push({ lat: 30 + rand() * 15, lon: -120 + rand() * 40, hams: hams(n) });
  }
  const out = clusterPoints(pts, { zoom: 4 });
  assert.ok(out.clusters.length + out.pins.length <= 2000);
  const sum =
    out.clusters.reduce((a, c) => a + c.count, 0) +
    out.pins.reduce((a, p) => a + p.hams.length, 0);
  assert.equal(sum, total);
});
