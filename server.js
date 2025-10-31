import express from 'express';
import pkg from 'pg';

const { Pool } = pkg;
const app = express();

// Config
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || ''; // empty = in-memory fallback

// Static files
app.use(express.json());
app.use(express.static('public'));

// In-memory fallback (used if no DB configured)
let mem = { pageViews: 0, clicks: 0, signups: 0, emails: [] };

// Optional Postgres pool
let pool = null;
if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL, ssl: sslOption(DATABASE_URL) });
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pageviews(id SERIAL PRIMARY KEY, at TIMESTAMP DEFAULT NOW());
        CREATE TABLE IF NOT EXISTS clicks(id SERIAL PRIMARY KEY, at TIMESTAMP DEFAULT NOW());
        CREATE TABLE IF NOT EXISTS signups(id SERIAL PRIMARY KEY, email TEXT NOT NULL, at TIMESTAMP DEFAULT NOW());
      `);
      console.log('DB ready');
    } catch (e) {
      console.error('DB init error:', e.message);
      pool = null; // fall back to memory if DB fails
    }
  })();
}

function sslOption(cs) {
  return /amazonaws|render|railway|supabase|azure|gcp|neon|timescale|heroku/i.test(cs)
    ? { rejectUnauthorized: false }
    : undefined;
}

// Count a page view for the homepage
app.get('/', async (req, res, next) => {
  try {
    if (pool) await pool.query('INSERT INTO pageviews DEFAULT VALUES;');
    else mem.pageViews++;
  } catch {}
  next();
});

// API routes
app.get('/api/ping', (_req, res) => res.json({ ok: true, message: 'Server is alive ✅' }));

app.post('/api/click', async (_req, res) => {
  try {
    if (pool) await pool.query('INSERT INTO clicks DEFAULT VALUES;');
    else mem.clicks++;
    const total = pool
      ? (await pool.query('SELECT COUNT(*)::int AS n FROM clicks')).rows[0].n
      : mem.clicks;
    res.json({ ok: true, totalClicks: total });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/signup', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email) return res.status(400).json({ ok: false, message: 'Email required' });
  try {
    if (pool) await pool.query('INSERT INTO signups(email) VALUES ($1);', [email]);
    else { mem.signups++; mem.emails.push(email); }
    res.json({ ok: true, message: 'Thanks! You’re on the list.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/metrics', async (_req, res) => {
  try {
    if (pool) {
      const pv = (await pool.query('SELECT COUNT(*)::int AS n FROM pageviews')).rows[0].n;
      const cl = (await pool.query('SELECT COUNT(*)::int AS n FROM clicks')).rows[0].n;
      const su = (await pool.query('SELECT COUNT(*)::int AS n FROM signups')).rows[0].n;
      res.json({ pageViews: pv, clicks: cl, signups: su, db: true });
    } else {
      res.json({ ...mem, db: false });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
