import { resolve } from 'node:path';
import { runWeekly, runDaily } from '../src/update/run.js';

const mode = process.argv[2];
const dataDir = resolve(process.env.DATA_DIR || './data');
const states = (process.env.LOAD_STATES ?? '')
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

try {
  if (mode === 'weekly') {
    const r = await runWeekly({ dataDir, states });
    console.log(`weekly: loaded ${r.licenseCount} licenses as of ${r.fileDate}`);
  } else if (mode === 'daily') {
    const r = await runDaily({ dataDir });
    console.log(`daily: applied ${r.applied.length} file(s)${r.applied.length ? `: ${r.applied.join(', ')}` : ''}`);
  } else {
    throw new Error('Usage: update.js weekly|daily');
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
