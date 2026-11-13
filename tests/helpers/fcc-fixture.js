import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import yazl from 'yazl';

const ENTRY_NAMES = { EN: 'EN.dat', HD: 'HD.dat', AM: 'AM.dat', HS: 'HS.dat', counts: 'counts' };

// Writes a zip shaped like an FCC ULS download. Each value is an array of lines.
export async function makeFccZip(dir, entries) {
  const zip = new yazl.ZipFile();
  for (const [key, lines] of Object.entries(entries)) {
    const name = ENTRY_NAMES[key] ?? key;
    zip.addBuffer(Buffer.from(lines.join('\r\n') + '\r\n', 'latin1'), name);
  }
  const path = join(dir, 'fixture.zip');
  const out = createWriteStream(path);
  zip.outputStream.pipe(out);
  zip.end();
  await once(out, 'close');
  return path;
}
