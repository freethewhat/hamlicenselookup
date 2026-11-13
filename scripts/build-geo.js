import { resolve } from 'node:path';
import { buildGeo } from '../src/geo/build.js';

try {
  await buildGeo({ dataDir: resolve(process.env.DATA_DIR || './data') });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
