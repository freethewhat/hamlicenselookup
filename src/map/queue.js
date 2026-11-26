// One shared queue feeds the Census geocoder, one batch at a time.
const NOT_ANSWERING = 'The map service is not answering. Try again later.';
const BUSY = 'The map is busy. Try again in a few minutes.';

export function createGeocodeQueue({
  geocode,
  store,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  batchSize = 1000,
  pauseMs = 2000,
  maxFailures = 4,
  cooldownMs = 600_000,
  idleMs = 60_000,
  maxTotal = 40_000,
} = {}) {
  let waiting = new Map(); // key -> { item, lastWanted }, in send order
  let front = []; // retried halves, each sent as its own batch before `waiting`
  let inflight = new Map(); // keys in the batch being sent
  let cooldownUntil = 0;
  let failures = 0;
  let worker = null;
  const index = new Map(); // key -> entry, for everything waiting, in front, or in flight

  const inCooldown = () => now() < cooldownUntil;

  function want(items) {
    if (inCooldown()) return { error: NOT_ANSWERING };
    const t = now();
    const fresh = [];
    const seen = new Set();
    for (const item of items) {
      const entry = index.get(item.key);
      if (entry) entry.lastWanted = t;
      else if (!seen.has(item.key)) {
        seen.add(item.key);
        fresh.push(item);
      }
    }
    if (index.size + fresh.length > maxTotal) return { error: BUSY };
    for (const item of fresh) {
      const entry = { item, lastWanted: t };
      waiting.set(item.key, entry);
      index.set(item.key, entry);
    }
    if (!worker && index.size > 0) worker = run();
    return { error: null };
  }

  async function run() {
    await Promise.resolve(); // let the caller's synchronous want() calls land first
    // `worker` is cleared by the finally block in the same synchronous step that
    // leaves the loop, so a later want() always restarts the worker.
    try {
      while (front.length > 0 || waiting.size > 0) {
        const cutoff = now() - idleMs;
        for (const [key, e] of waiting) {
          if (e.lastWanted < cutoff) { waiting.delete(key); index.delete(key); }
        }
        for (const h of front) for (const e of h) if (e.lastWanted < cutoff) index.delete(e.item.key);
        front = front.map((h) => h.filter((e) => e.lastWanted >= cutoff)).filter((h) => h.length);
        if (front.length === 0 && waiting.size === 0) break;

        let batch;
        if (front.length > 0) {
          batch = front.shift();
        } else {
          batch = [];
          for (const [key, e] of waiting) {
            if (batch.length >= batchSize) break;
            batch.push(e);
            waiting.delete(key);
          }
        }
        inflight = new Map(batch.map((e) => [e.item.key, e]));
        try {
          // Census row ids are per-batch indexes, mapped back here, so no echo or quoting
          // of an address key can make rows look missing.
          const answer = await geocode(batch.map((e, i) => ({ ...e.item, id: String(i) })));
          const rows = [];
          for (const [id, r] of answer) {
            const e = /^\d+$/.test(id) ? batch[Number(id)] : undefined;
            if (e) rows.push({ key: e.item.key, status: r.status, lat: r.lat, lon: r.lon });
          }
          // A 200 with no recognized rows (an outage page, say) is a failure, not an answer.
          if (rows.length === 0) throw new Error('Census answer had no recognized rows');
          store.save(rows);
          for (const key of inflight.keys()) index.delete(key);
          failures = 0;
          inflight = new Map();
        } catch {
          // A geocode failure, an empty answer, or a store.save failure is one failed batch: halve and retry.
          const mid = Math.ceil(batch.length / 2);
          const halves = [batch.slice(0, mid), batch.slice(mid)].filter((h) => h.length);
          front = [...halves, ...front];
          inflight = new Map();
          const wait = pauseMs * 2 ** failures;
          failures++;
          if (failures >= maxFailures) {
            waiting.clear();
            front = [];
            index.clear();
            failures = 0;
            cooldownUntil = now() + cooldownMs;
            break;
          }
          await sleep(wait);
          continue;
        }
        if (front.length > 0 || waiting.size > 0) await sleep(pauseMs);
      }
    } finally {
      worker = null;
    }
  }

  return {
    want,
    isPending: (key) => index.has(key),
    error: () => (inCooldown() ? NOT_ANSWERING : null),
    whenIdle: async () => {
      while (worker) await worker; // a want() during the last step may have started a new one
    },
  };
}
