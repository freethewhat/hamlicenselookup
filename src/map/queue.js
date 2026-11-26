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

  const inCooldown = () => now() < cooldownUntil;

  const pendingCount = () => waiting.size + inflight.size + front.reduce((n, h) => n + h.length, 0);

  function want(items) {
    if (inCooldown()) return { error: NOT_ANSWERING };
    const t = now();
    const fresh = [];
    for (const item of items) {
      const entry = waiting.get(item.key) ?? inflight.get(item.key)
        ?? front.flat().find((e) => e.item.key === item.key);
      if (entry) entry.lastWanted = t;
      else if (!fresh.some((f) => f.key === item.key)) fresh.push(item);
    }
    if (pendingCount() + fresh.length > maxTotal) return { error: BUSY };
    for (const item of fresh) waiting.set(item.key, { item, lastWanted: t });
    if (!worker && pendingCount() > 0) worker = run().finally(() => { worker = null; });
    return { error: null };
  }

  async function run() {
    await Promise.resolve(); // let the caller's synchronous want() calls land first
    while (front.length > 0 || waiting.size > 0) {
      const cutoff = now() - idleMs;
      for (const [key, e] of waiting) if (e.lastWanted < cutoff) waiting.delete(key);
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
        const answer = await geocode(batch.map((e) => ({ ...e.item, id: e.item.key })));
        const rows = [];
        for (const [id, r] of answer) {
          if (inflight.has(id)) rows.push({ key: id, status: r.status, lat: r.lat, lon: r.lon });
        }
        store.save(rows);
        failures = 0;
        inflight = new Map();
      } catch {
        // A geocode or store.save failure is one failed batch: halve and retry.
        const mid = Math.ceil(batch.length / 2);
        const halves = [batch.slice(0, mid), batch.slice(mid)].filter((h) => h.length);
        front = [...halves, ...front];
        inflight = new Map();
        const wait = pauseMs * 2 ** failures;
        failures++;
        if (failures >= maxFailures) {
          waiting.clear();
          front = [];
          failures = 0;
          cooldownUntil = now() + cooldownMs;
          break;
        }
        await sleep(wait);
        continue;
      }
      if (front.length > 0 || waiting.size > 0) await sleep(pauseMs);
    }
  }

  return {
    want,
    isPending: (key) => waiting.has(key) || inflight.has(key) || front.some((h) => h.some((e) => e.item.key === key)),
    error: () => (inCooldown() ? NOT_ANSWERING : null),
    whenIdle: () => worker ?? Promise.resolve(),
  };
}
