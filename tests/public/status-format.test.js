import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusView, dataLoadingNotice } from '../../public/js/status-format.js';

const NOW = new Date('2026-11-13T12:00:10Z');
const running = {
  state: 'running', stepLabel: 'Downloading FCC file', percent: 45, done: 89_000_000, total: 198_117_503, unit: 'bytes',
  updatedAt: '2026-11-13T12:00:09Z',
};

test('running with bytes shows percent and decimal megabytes', () => {
  const v = statusView(running, NOW);
  assert.deepEqual(v, {
    visible: true,
    tone: 'info',
    text: 'Updating license data: Downloading FCC file, 45% (89 of 198 MB)',
    percent: 45,
  });
});

test('198117503 bytes rounds to 198 MB', () => {
  const v = statusView({ ...running, done: 198_117_503, percent: 100 }, NOW);
  assert.match(v.text, /\(198 of 198 MB\)$/);
});

test('running with no percent has no % part', () => {
  const v = statusView({ state: 'running', stepLabel: 'Building indexes', percent: null, done: null, total: null, unit: null }, NOW);
  assert.equal(v.text, 'Updating license data: Building indexes');
  assert.equal(v.percent, null);
});

test('running with items shows percent but no MB part', () => {
  const v = statusView({ state: 'running', stepLabel: 'Finding first licenses', percent: 30, done: 3, total: 10, unit: 'items' }, NOW);
  assert.equal(v.text, 'Updating license data: Finding first licenses, 30%');
});

test('running with unknown total shows no MB part', () => {
  const v = statusView({ ...running, percent: null, total: null }, NOW);
  assert.equal(v.text, 'Updating license data: Downloading FCC file');
});

test('done within 10 s says data updated to the date', () => {
  const v = statusView({ state: 'done', updatedAt: '2026-11-13T12:00:05Z' }, NOW, '2026-11-08');
  assert.deepEqual(v, { visible: true, tone: 'success', text: 'Data updated to Nov 8, 2026', percent: 100 });
});

test('done older than 10 s is not visible', () => {
  assert.equal(statusView({ state: 'done', updatedAt: '2026-11-13T11:59:59Z' }, NOW, '2026-11-08').visible, false);
});

test('failed is a plain warning with the data date and no technical error', () => {
  const failed = { state: 'failed', error: 'Download failed with HTTP 500 for https://data.fcc.gov/x.zip' };
  assert.deepEqual(statusView(failed, NOW, '2026-11-08'), {
    visible: true,
    tone: 'warn',
    text: 'The last data update failed. Showing data as of Nov 8, 2026. It will retry automatically.',
    percent: null,
  });
  assert.equal(statusView(failed, NOW).text, 'The last data update failed. It will retry automatically.');
});

test('interrupted explains the retry', () => {
  const v = statusView({ state: 'interrupted' }, NOW);
  assert.equal(v.tone, 'error');
  assert.equal(v.text, 'The last data update stopped before finishing. It will retry on the next start or schedule.');
});

test('idle and missing status are not visible', () => {
  assert.equal(statusView({ state: 'idle' }, NOW).visible, false);
  assert.equal(statusView(null, NOW).visible, false);
});

test('data loading notice only while an update runs and data is missing', () => {
  const notice = 'License data is loading — see the progress above.';
  const err = { status: 503, message: 'Data not loaded yet' };
  assert.equal(dataLoadingNotice(err, true), notice);
  assert.equal(dataLoadingNotice(err, false), null);
  assert.equal(dataLoadingNotice({ status: 503, message: 'Data is being updated. Try again soon.' }, true), notice);
  assert.equal(dataLoadingNotice({ status: 503, message: 'Data is being updated. Try again soon.' }, false), null);
  assert.equal(dataLoadingNotice({ status: 500, message: 'Data not loaded yet' }, true), null);
});

test('small downloads omit the MB part; unknown total omits the percent', () => {
  const small = statusView({ state: 'running', stepLabel: 'Downloading', percent: 0, done: 0, total: 35_615, unit: 'bytes' }, NOW);
  assert.equal(small.text, 'Updating license data: Downloading, 0%');
  const unknown = statusView({ state: 'running', stepLabel: 'Downloading', percent: 0, done: 0, total: null, unit: 'bytes' }, NOW);
  assert.equal(unknown.text, 'Updating license data: Downloading');
});

test('done message is timed from the client when doneSince is given', () => {
  const done = { state: 'done', updatedAt: '2026-11-13T11:00:00Z' }; // server stamp is old
  const seenAt = +NOW - 4000;
  assert.equal(statusView(done, NOW, '2026-11-08', seenAt).visible, true);
  assert.equal(statusView(done, NOW, '2026-11-08', +NOW - 10_001).visible, false);
  assert.equal(statusView(done, NOW, '2026-11-08').visible, false); // fresh page load, stale done
});
