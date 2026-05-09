'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

const SONARR_URL = (process.env.SONARR_URL || '').replace(/\/$/, '');
const SONARR_API_KEY = process.env.SONARR_API_KEY || '';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '';

if (!SONARR_URL || !SONARR_API_KEY) {
  console.error('[ERROR] SONARR_URL and SONARR_API_KEY environment variables are required.');
  process.exit(1);
}

// ── Security headers ─────────────────────────────────────────────────────────
// CSS and JS are inlined in index.html, so 'unsafe-inline' is required.
// No external resources are loaded — connectSrc is self-only (API proxy).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", "data:"],
      connectSrc:     ["'self'"],
      fontSrc:        ["'self'"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

app.disable('x-powered-by');

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = ALLOWED_ORIGINS
  ? ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(new Error('CORS not configured'), false);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked: ${origin}`), false);
  },
  methods: ['GET'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many scan requests, please wait.' },
});

// ── Sonarr proxy ──────────────────────────────────────────────────────────────
async function sonarrFetch(sonarrPath, query) {
  const url = new URL(SONARR_URL + sonarrPath);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url.toString(), {
    headers: { 'X-Api-Key': SONARR_API_KEY, 'Accept': 'application/json' },
    timeout: 30000,
  });
  if (!response.ok) {
    const err = new Error(`Sonarr returned ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

// ── API routes ────────────────────────────────────────────────────────────────
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

router.get('/sonarr/series', heavyLimiter, async (req, res) => {
  try {
    const data = await sonarrFetch('/api/v3/series', {});
    res.json(data.map(s => ({
      id: s.id,
      title: s.title,
      seasonCount: s.seasonCount,
      status: s.status,
    })));
  } catch (e) {
    console.error('[sonarr/series]', e.message);
    res.status(e.status || 502).json({ error: e.message });
  }
});

router.get('/sonarr/episode', apiLimiter, async (req, res) => {
  const seriesId = parseInt(req.query.seriesId, 10);
  if (!seriesId || isNaN(seriesId)) return res.status(400).json({ error: 'Missing or invalid seriesId' });
  try {
    const data = await sonarrFetch('/api/v3/episode', { seriesId });
    res.json(data.map(e => ({
      id: e.id,
      seriesId: e.seriesId,
      seasonNumber: e.seasonNumber,
      episodeNumber: e.episodeNumber,
      title: e.title,
      hasFile: e.hasFile,
      episodeFileId: e.episodeFileId,
    })));
  } catch (e) {
    console.error('[sonarr/episode]', e.message);
    res.status(e.status || 502).json({ error: e.message });
  }
});

router.get('/sonarr/episodefile', apiLimiter, async (req, res) => {
  const seriesId = parseInt(req.query.seriesId, 10);
  if (!seriesId || isNaN(seriesId)) return res.status(400).json({ error: 'Missing or invalid seriesId' });
  try {
    const data = await sonarrFetch('/api/v3/episodefile', { seriesId });
    res.json(data.map(f => ({
      id: f.id,
      seriesId: f.seriesId,
      quality: f.quality,
    })));
  } catch (e) {
    console.error('[sonarr/episodefile]', e.message);
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.use('/api', router);

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: '1h',
  index: 'index.html',
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('CORS')) return res.status(403).json({ error: 'Forbidden' });
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[sonarr-quality-inspector] Listening on port ${PORT}`);
  console.log(`[sonarr-quality-inspector] Sonarr: ${SONARR_URL}`);
  console.log(`[sonarr-quality-inspector] CORS: ${allowedOrigins.length ? allowedOrigins.join(', ') : 'same-origin only'}`);
});
