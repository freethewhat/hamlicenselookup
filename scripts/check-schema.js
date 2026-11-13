import { checkSchemas } from '../src/db/handle.js';

const { licenses, geo } = checkSchemas(process.env.DATA_DIR ?? './data');
console.log(`licenses=${licenses} geo=${geo}`);
process.exit(licenses === 'ok' && geo === 'ok' ? 0 : 3);
