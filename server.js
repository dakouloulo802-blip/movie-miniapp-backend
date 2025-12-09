// server.js - simple Express server for your Movie MiniApp (MVP)

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const crypto = require('crypto');
const path = require('path');

const app = express();

// Initialize Firebase Admin from environment secret if present
let firebaseInitialized = false;

if (process.env.SERVICE_ACCOUNT_JSON) {
  try {
    const sa = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    console.log('Firebase initialized from SERVICE_ACCOUNT_JSON env');
    firebaseInitialized = true;
  } catch (err) {
    console.error('Failed to parse SERVICE_ACCOUNT_JSON:', err.message);
    console.error('Make sure SERVICE_ACCOUNT_JSON contains the complete Firebase service account JSON with project_id, private_key, client_email, etc.');
  }
}

if (!firebaseInitialized) {
  try {
    admin.initializeApp();
    console.log('Firebase initialized with default credentials');
    firebaseInitialized = true;
  } catch (err) {
    console.warn('Firebase default init failed:', err.message);
  }
}

const db = firebaseInitialized ? admin.firestore() : null;

// Express setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend that lives in webapp/
const webappPath = path.join(__dirname, 'webapp');
app.use(express.static(webappPath));
app.get('/', (req, res) => {
  res.sendFile(path.join(webappPath, 'index.html'));
});

// Config constants
const FREE_DAILY_LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || '2', 10);
const UNLOCK_TTL_SECONDS = parseInt(process.env.UNLOCK_TTL_SECONDS || '300', 10);
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me';
const BLOGGER_ADMIN_BLOG_ID = process.env.BLOGGER_ADMIN_BLOG_ID;
const BLOGGER_PUBLIC_BLOG_ID = process.env.BLOGGER_PUBLIC_BLOG_ID || null;

// Helper: OAuth2 client with refresh token (for Blogger)
function getOauthClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.BLOGGER_CLIENT_ID,
    process.env.BLOGGER_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: process.env.BLOGGER_REFRESH_TOKEN });
  return oauth2;
}

// Admin middleware
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if (!token || token !== ADMIN_SECRET) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// Utility: simple HMAC-signed token (MVP). Replace with JWT for production.
function issueUnlockToken(tmdb_id, userId, ttlSeconds = UNLOCK_TTL_SECONDS) {
  const exp = Date.now() + ttlSeconds * 1000;
  const payload = `${tmdb_id}:${userId}:${exp}`;
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
  const token = Buffer.from(`${payload}:${sig}`).toString('base64');
  return { token, expires_at: exp };
}

function verifyUnlockToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 4) return { ok: false, err: 'bad_format' };
    const [tmdb_id, userId, expStr, ...sigParts] = parts;
    const sig = sigParts.join(':');
    const payload = `${tmdb_id}:${userId}:${expStr}`;
    const expectedSig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('hex');
    if (expectedSig !== sig) return { ok: false, err: 'bad_sig' };
    if (Date.now() > parseInt(expStr, 10)) return { ok: false, err: 'expired' };
    return { ok: true, tmdb_id, userId };
  } catch (e) {
    return { ok: false, err: 'exception' };
  }
}

// Helper: get or create quota doc for userId
async function getQuotaDocRef(userId) {
  const ref = db.collection('user_quota').doc(userId);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      user_id: userId,
      daily_count: 0,
      last_reset: admin.firestore.Timestamp.now(),
      last_unlock_at: null,
      blocked_until: null
    });
    return ref;
  }
  return ref;
}

function needsDailyReset(lastResetTimestamp) {
  if (!lastResetTimestamp) return true;
  const now = new Date();
  const midnightUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);
  const lastMs = lastResetTimestamp.toMillis ? lastResetTimestamp.toMillis() : new Date(lastResetTimestamp).getTime();
  return lastMs < midnightUTC;
}

/* Blogger sync endpoint (robust version) */
app.get('/sync', requireAdmin, async (req, res) => {
  try {
    if (!BLOGGER_ADMIN_BLOG_ID) {
      console.error('Missing BLOGGER_ADMIN_BLOG_ID in secrets');
      return res.status(500).json({ error: 'server_misconfigured', message: 'BLOGGER_ADMIN_BLOG_ID missing' });
    }

    const oauth = getOauthClient();
    const blogger = google.blogger({ version: 'v3', auth: oauth });

    // fetch drafts and published separately (Blogger API doesn't accept "draft,published")
    const respDraft = await blogger.posts.list({
      blogId: BLOGGER_ADMIN_BLOG_ID,
      status: 'draft',
      fetchBodies: true,
      maxResults: 500
    }).catch(err => {
      console.error('Error fetching drafts:', err?.response?.data || err.message || err);
      throw err;
    });

    const respPublished = await blogger.posts.list({
      blogId: BLOGGER_ADMIN_BLOG_ID,
      status: 'live',
      fetchBodies: true,
      maxResults: 500
    }).catch(err => {
      console.error('Error fetching published:', err?.response?.data || err.message || err);
      throw err;
    });

    // merge items (handle missing arrays)
    const items = [
      ...(respDraft && respDraft.data && respDraft.data.items ? respDraft.data.items : []),
      ...(respPublished && respPublished.data && respPublished.data.items ? respPublished.data.items : [])
    ];

    console.log(`Fetched posts: drafts=${(respDraft.data.items||[]).length} published=${(respPublished.data.items||[]).length} total=${items.length}`);

    let synced = 0;
    for (const post of items) {
      try {
        const body = post.content || '';
        const m = body.match(/<!--\s*({[\s\S]*?})\s*-->/);
        if (!m) continue;
        let meta;
        try { meta = JSON.parse(m[1]); } catch (e) {
          console.warn('Invalid JSON meta in post', post.id);
          continue;
        }
        if (!meta.tmdb_id) continue;
        const docRef = db.collection('movies').doc(String(meta.tmdb_id));
        await docRef.set({
          title: meta.title || '',
          tmdb_id: meta.tmdb_id,
          imdb: meta.imdb || null,
          year: meta.year || null,
          poster_url: meta.poster_url || null,
          overview: meta.overview || null,
          links: meta.links || [],
          admin_post_id: post.id,
          published: false,
          synced_at: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        synced++;
      } catch (innerErr) {
        console.error('Error processing post', post.id, innerErr);
      }
    }

    console.log(`Sync complete. Upserted ${synced} posts.`);
    return res.json({ ok: true, synced });
  } catch (err) {
    console.error('Sync failed:', err?.response?.data || err.message || err);
    const msg = (err && err.response && err.response.data) ? err.response.data : (err && err.message) ? err.message : 'unknown';
    return res.status(500).json({ error: 'sync_failed', message: msg });
  }
});

/* Admin endpoint to list all movies including unpublished */
app.get('/admin/movies', requireAdmin, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized' });
  try {
    const snap = await db.collection('movies').limit(500).get();
    const out = [];
    snap.forEach(d => {
      const data = d.data();
      out.push({
        tmdb_id: data.tmdb_id,
        title: data.title,
        published: data.published,
        year: data.year
      });
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Public endpoints */
app.get('/movies', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not initialized. Check SERVICE_ACCOUNT_JSON secret.' });
  try {
    const snap = await db.collection('movies').where('published', '==', true).limit(500).get();
    const out = [];
    snap.forEach(d => {
      const data = d.data();
      out.push({
        title: data.title,
        tmdb_id: data.tmdb_id,
        poster_url: data.poster_url,
        overview: data.overview,
        year: data.year
      });
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/movie/:tmdb_id', async (req, res) => {
  try {
    const doc = await db.collection('movies').doc(String(req.params.tmdb_id)).get();
    if (!doc.exists) return res.status(404).json({ error: 'not found' });
    const data = doc.data();
    if (!data.published) return res.status(403).json({ error: 'not published' });
    res.json({
      title: data.title,
      tmdb_id: data.tmdb_id,
      poster_url: data.poster_url,
      overview: data.overview,
      year: data.year,
      links: data.links || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Admin publish endpoint */
app.post('/admin/publish/:tmdb_id', requireAdmin, async (req, res) => {
  try {
    const tmdb_id = String(req.params.tmdb_id);
    const docRef = db.collection('movies').doc(tmdb_id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'not found' });
    const data = doc.data();
    await docRef.update({ published: true, published_at: admin.firestore.FieldValue.serverTimestamp() });
    if (BLOGGER_PUBLIC_BLOG_ID) {
      const oauth = getOauthClient();
      const blogger = google.blogger({ version: 'v3', auth: oauth });
      await blogger.posts.insert({
        blogId: BLOGGER_PUBLIC_BLOG_ID,
        requestBody: {
          title: `${data.title} — Download`,
          content: `<!-- migrated_from_admin:${data.admin_post_id} -->\n<p>${data.title} (${data.year}) — download links below.</p>`
        }
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* Unlock logic with quota enforcement */
app.post('/unlock/:tmdb_id', async (req, res) => {
  try {
    const tmdb_id = String(req.params.tmdb_id);
    const { userId, adSuccess, adType } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const qRef = await getQuotaDocRef(userId);
    const qSnap = await qRef.get();
    let quota = qSnap.exists ? qSnap.data() : null;
    if (needsDailyReset(quota.last_reset)) {
      await qRef.update({ daily_count: 0, last_reset: admin.firestore.FieldValue.serverTimestamp() });
      quota.daily_count = 0;
    }
    if (quota.blocked_until && quota.blocked_until.toMillis && quota.blocked_until.toMillis() > Date.now()) {
      return res.status(429).json({ error: 'cooldown', blocked_until: quota.blocked_until.toDate() });
    }
    if ((quota.daily_count || 0) < FREE_DAILY_LIMIT && !adSuccess) {
      await qRef.update({
        daily_count: admin.firestore.FieldValue.increment(1),
        last_unlock_at: admin.firestore.FieldValue.serverTimestamp()
      });
      const { token, expires_at } = issueUnlockToken(tmdb_id, userId);
      return res.json({ ok: true, token, expires_in: (expires_at - Date.now()) / 1000, used_free_quota: true, remaining_free: FREE_DAILY_LIMIT - ((quota.daily_count || 0) + 1) });
    }
    if (adSuccess && adType === 'interstitial') {
      await qRef.update({ last_unlock_at: admin.firestore.FieldValue.serverTimestamp() });
      const { token, expires_at } = issueUnlockToken(tmdb_id, userId);
      return res.json({ ok: true, token, expires_in: (expires_at - Date.now()) / 1000, used_free_quota: false, monetized: true });
    }
    if (adSuccess && adType === 'rewarded') {
      await qRef.update({ last_unlock_at: admin.firestore.FieldValue.serverTimestamp() });
      const { token, expires_at } = issueUnlockToken(tmdb_id, userId);
      return res.json({ ok: true, token, expires_in: (expires_at - Date.now()) / 1000, used_free_quota: false, monetized: true });
    }
    return res.status(402).json({ error: 'quota_exhausted', requireInterstitial: true, message: 'Watch a short interstitial ad to continue' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/validate-unlock/:tmdb_id', async (req, res) => {
  try {
    const tmdb_id = String(req.params.tmdb_id);
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });
    const v = verifyUnlockToken(token);
    if (!v.ok) return res.status(403).json({ error: 'invalid_token', reason: v.err });
    if (v.tmdb_id !== tmdb_id) return res.status(403).json({ error: 'token_mismatch' });
    const doc = await db.collection('movies').doc(tmdb_id).get();
    if (!doc.exists) return res.status(404).json({ error: 'movie not found' });
    const data = doc.data();
    if (!data.published) return res.status(403).json({ error: 'not published' });
    return res.json({ ok: true, links: data.links || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Start server using env PORT or 5000
const port = Number(process.env.PORT) || 5000;
app.listen(port, '0.0.0.0', () => console.log(`Server listening on port ${port}`));
