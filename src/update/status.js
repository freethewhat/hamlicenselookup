import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STATUS_FILE = 'update-status.json';
const INTERRUPTED_AFTER_MS = 120_000;

// Default label and unit for each step name used by the update code.
const STEPS = {
  geo: { label: 'Building map data', unit: null },
  download: { label: 'Downloading FCC file', unit: 'bytes' },
  import: { label: 'Importing FCC records', unit: 'bytes' },
  index: { label: 'Building indexes', unit: null },
  classify: { label: 'Finding first licenses', unit: 'items' },
  swap: { label: 'Switching to the new data', unit: null },
  daily: { label: 'Applying daily updates', unit: 'bytes' },
};

/**
 * Writes the progress of one update run to DATA_DIR/update-status.json, atomically (tmp file,
 * then rename) so readers never see a partial file. Write failures are logged once and
 * otherwise ignored: reporting must never break an update.
 */
export function createStatusWriter(dataDir, job, { now = () => new Date(), throttleMs = 500 } = {}) {
  const path = join(dataDir, STATUS_FILE);
  const startedAt = now().toISOString();
  const s = {
    state: 'running', job, step: null, stepLabel: '', done: null, total: null, unit: null,
    percent: null, startedAt, updatedAt: startedAt, message: null, error: null,
  };
  let lastWrite = -Infinity;
  let warned = false;

  function write() {
    const t = now();
    s.updatedAt = t.toISOString();
    lastWrite = +t;
    try {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(s));
      renameSync(`${path}.tmp`, path);
    } catch (err) {
      if (!warned) {
        warned = true;
        console.error(`Could not write ${path}: ${err.message}`);
      }
    }
  }

  const setPercent = () => {
    s.percent = s.total > 0 && s.done !== null ? Math.min(100, Math.round((100 * s.done) / s.total)) : null;
  };

  return {
    step(step, stepLabel, { total = null, unit = null } = {}) {
      Object.assign(s, { step, stepLabel, total, unit, done: total === null ? null : 0 });
      setPercent();
      write();
    },
    progress(done) {
      s.done = done;
      setPercent();
      if (+now() - lastWrite >= throttleMs) write();
    },
    finish(message = null) {
      Object.assign(s, {
        state: 'done', message, error: null, step: null, stepLabel: '', done: null, total: null, unit: null, percent: null,
      });
      write();
    },
    fail(error) {
      Object.assign(s, { state: 'failed', error: String(error) });
      write();
    },
  };
}

/** A writer that does nothing, for callers that do not report progress. */
export const nullStatus = {
  step() {}, progress() {}, finish() {}, fail() {},
};

/**
 * Adapts a status writer to the onProgress(step, done, total, label?) callbacks of the
 * loaders: a new step or label starts a new status step; otherwise only progress moves.
 */
export function createProgressSink(status) {
  let key = null;
  return (step, done = null, total = null, label = undefined) => {
    const def = STEPS[step];
    const stepLabel = label ?? def.label;
    const next = `${step}|${stepLabel}`;
    if (next !== key) {
      key = next;
      status.step(step, stepLabel, { total, unit: def.unit });
    }
    if (done !== null && total !== null) status.progress(done);
  };
}

export function readStatus(dataDir, now = new Date()) {
  let s;
  try {
    s = JSON.parse(readFileSync(join(dataDir, STATUS_FILE), 'utf8'));
  } catch {
    return { state: 'idle' };
  }
  if (s.state === 'running' && +now - Date.parse(s.updatedAt) > INTERRUPTED_AFTER_MS) {
    return { ...s, state: 'interrupted' };
  }
  return s;
}
