import yauzl from 'yauzl';

const open = (path) => new Promise((resolve, reject) => {
  yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip)));
});

/**
 * Finds entries in a zip by case-insensitive name. Returns a Map keyed by the
 * name as requested, whose values open a fresh stream for that entry on demand.
 * Missing entries are absent from the map.
 */
export async function readZipEntries(zipPath, names) {
  const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
  const zip = await open(zipPath);
  const found = new Map();
  await new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', (entry) => {
      const name = wanted.get(entry.fileName.toLowerCase());
      if (name) {
        found.set(name, () => new Promise((res, rej) => {
          zip.openReadStream(entry, (err, stream) => (err ? rej(err) : res(stream)));
        }));
      }
      zip.readEntry();
    });
    zip.readEntry();
  });
  found.close = () => zip.close();
  return found;
}
