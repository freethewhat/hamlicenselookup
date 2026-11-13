import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { openHandle } from '../db/handle.js';
import { resolveZips } from '../search/resolve.js';
import { countLicenses, iterateLicenses } from '../search/query.js';
import { writeCsv } from '../search/csv.js';
import { readStatus } from '../update/status.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_ZIPS = 5000;
const PREVIEW_ROWS = 100;
const STALE_DAYS = 10;
const DAY_MS = 86_400_000;
// Map tiles come from OpenStreetMap; Leaflet sets inline styles on map elements.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
].join('; ');

class HttpError extends Error {
  constructor(status, body) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

// Validates the request body; returns the resolved ZIP list and normalized filters.
function parseSearch(geoDb, body) {
  const { zips = [], counties = [], filters = {} } = body ?? {};
  if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new HttpError(400, { error: 'filters must be an object', invalid: [] });
  }
  if (!isStringArray(zips) || !isStringArray(counties)) {
    throw new HttpError(400, { error: 'zips and counties must be lists of strings', invalid: [] });
  }
  const since = filters.firstLicenseSince ?? null;
  if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new HttpError(400, { error: 'firstLicenseSince must be YYYY-MM-DD', invalid: [] });
  }
  const normalized = {
    firstLicenseSince: since,
    includeUpgrades: filters.includeUpgrades === true,
    includeExpired: filters.includeExpired === true,
    includeClubs: filters.includeClubs === true,
  };
  const resolved = resolveZips(geoDb, { zips, counties });
  if (resolved.invalid.length) {
    throw new HttpError(400, { error: 'Some ZIP codes are not valid', invalid: resolved.invalid });
  }
  if (resolved.zips.length === 0) {
    throw new HttpError(400, { error: 'Pick at least one ZIP code or county', invalid: [] });
  }
  if (resolved.zips.length > MAX_ZIPS) {
    throw new HttpError(400, { error: `Too many ZIP codes (max ${MAX_ZIPS})` });
  }
  return { zips: resolved.zips, filters: normalized };
}

export function createApp({
  dataDir, now = () => new Date(), recheckMs, rateLimitPerMinute = 120,
  exportDrainTimeoutMs = 60_000, exportTimeoutMs = 5 * 60_000,
}) {
  const handle = openHandle({
    licenseDbPath: join(dataDir, 'licenses.db'),
    geoDbPath: join(dataDir, 'geo.db'),
    recheckMs,
  });
  const app = express();
  app.locals.handle = handle;
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': CSP });
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Update progress works with no data loaded. The page polls it every 2 s, so it gets its own limit.
  app.get(
    '/api/status',
    rateLimit({ windowMs: 60_000, limit: Math.max(rateLimitPerMinute, 120), standardHeaders: true, legacyHeaders: false }),
    (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(readStatus(dataDir));
    },
  );

  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: rateLimitPerMinute, standardHeaders: true, legacyHeaders: false }),
    express.json({ limit: '1mb' }),
    (req, res, next) => {
      const status = handle.status();
      if (status === 'missing') return res.status(503).json({ error: 'Data not loaded yet' });
      if (status === 'outdated') {
        return res.status(503).json({ error: 'Data is being updated. Try again soon.' });
      }
      req.db = handle.get();
      next();
    },
  );

  app.get('/api/meta', (req, res) => {
    const meta = Object.fromEntries(req.db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
    const asOf = Date.parse(meta.data_as_of ?? '');
    const stale = Number.isNaN(asOf) || now().getTime() - asOf > STALE_DAYS * DAY_MS;
    res.json({ dataAsOf: meta.data_as_of ?? null, licenseCount: Number(meta.license_count ?? 0), stale });
  });

  app.get('/api/states', (req, res) => {
    res.json(req.db.prepare('SELECT abbr, name FROM geo.states ORDER BY name').all());
  });

  const stateParam = (req) => {
    const st = String(req.query.state ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(st)) throw new HttpError(400, { error: 'state is required' });
    return st;
  };

  app.get('/api/counties', (req, res) => {
    res.json(
      req.db
        .prepare(
          `SELECT c.geoid, c.name, c.state, COUNT(z.zip) AS zipCount
           FROM geo.counties c LEFT JOIN geo.zips z ON z.county_geoid = c.geoid
           WHERE c.state = ? GROUP BY c.geoid ORDER BY c.name`,
        )
        .all(stateParam(req)),
    );
  });

  app.get('/api/zips', (req, res) => {
    const rows = req.db
      .prepare(
        `SELECT z.zip, z.county_geoid AS countyGeoid, c.name AS countyName, z.has_shape AS hasShape
         FROM geo.zips z LEFT JOIN geo.counties c ON c.geoid = z.county_geoid
         WHERE z.state = ? ORDER BY z.zip`,
      )
      .all(stateParam(req));
    res.json(rows.map((r) => ({ ...r, hasShape: !!r.hasShape })));
  });

  app.post('/api/search', (req, res) => {
    const { zips, filters } = parseSearch(req.db, req.body);
    res.json({
      count: countLicenses(req.db, zips, filters),
      preview: [...iterateLicenses(req.db, zips, filters, PREVIEW_ROWS)],
      zipCount: zips.length,
    });
  });

  app.post('/api/export', async (req, res) => {
    const { zips, filters } = parseSearch(req.db, req.body);
    const day = now().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hams-${day}.csv"`,
    });
    await writeCsv(iterateLicenses(req.db, zips, filters), res, {
      drainTimeoutMs: exportDrainTimeoutMs,
      deadlineMs: exportTimeoutMs,
    });
  });

  // HTML/JS/CSS revalidate on every load so a deploy is picked up at once; map data and vendor files cache.
  app.use(express.static(join(ROOT, 'public'), { maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  app.use('/vendor/leaflet', express.static(join(ROOT, 'node_modules', 'leaflet', 'dist'), { maxAge: '1d' }));
  app.use('/geo', express.static(join(dataDir, 'geo'), { maxAge: '1d' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) return res.status(err.status).json(err.body);
    if (err.status === 400 || err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    if (err.status === 413) return res.status(413).json({ error: 'Request too large' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}
