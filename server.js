'use strict';

const express = require('express');
const path = require('path');

// ---------- Configuration (all secrets come from environment variables) ----------
const PORT = Number(process.env.PORT) || 3000; // Render sets PORT; 3000 is only for local runs
const HOST = '0.0.0.0';
const ACCESS_TOKEN = (process.env.INSTAGRAM_ACCESS_TOKEN || '').trim();
const EXPECTED_USERNAME = (process.env.INSTAGRAM_EXPECTED_USERNAME || '').trim().replace(/^@/, '').toLowerCase();
const API_VERSION = process.env.INSTAGRAM_API_VERSION || 'v26.0';
const API_BASE = process.env.INSTAGRAM_API_BASE || 'https://graph.instagram.com'; // override only for tests
const CACHE_MS = (Number(process.env.CACHE_SECONDS) || 120) * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

class UpstreamError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Map Instagram/Meta error responses to friendly messages. Never include the token.
function mapApiError(status, body) {
  const e = body && body.error;
  const code = e && e.code;
  if (code === 190 || status === 401) {
    return new UpstreamError('TOKEN_INVALID', 'The Instagram access token is invalid or expired. Generate a new one and update INSTAGRAM_ACCESS_TOKEN in Render.');
  }
  if ([4, 17, 32, 613].includes(code) || status === 429) {
    return new UpstreamError('RATE_LIMITED', 'Instagram is rate limiting this app. Will retry shortly.');
  }
  if ([10, 200, 230].includes(code) || status === 403) {
    return new UpstreamError('PERMISSION_DENIED', 'The token lacks permission. It needs the instagram_business_basic permission on a Business or Creator account.');
  }
  if (status >= 500) return new UpstreamError('UPSTREAM_DOWN', `Instagram API returned HTTP ${status}.`);
  return new UpstreamError('HTTP_ERROR', `Instagram API returned HTTP ${status}${e && e.message ? ': ' + String(e.message).slice(0, 160) : ''}.`);
}

async function fetchFresh() {
  if (!ACCESS_TOKEN) {
    throw new UpstreamError('CONFIG_MISSING', 'INSTAGRAM_ACCESS_TOKEN is not set. Add it in the Render dashboard under Environment.');
  }
  const url = `${API_BASE}/${API_VERSION}/me?fields=user_id,username,followers_count&access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    throw err.name === 'AbortError'
      ? new UpstreamError('TIMEOUT', 'Instagram took too long to respond.')
      : new UpstreamError('NETWORK', 'Could not reach the Instagram API.');
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) throw mapApiError(res.status, body);

  const followers = body && body.followers_count;
  if (!body || typeof body.username !== 'string' || !Number.isInteger(followers) || followers < 0) {
    throw new UpstreamError('INVALID_RESPONSE', 'Instagram returned an unexpected response (no followers_count). Check the account is a Business or Creator account.');
  }
  if (EXPECTED_USERNAME && body.username.toLowerCase() !== EXPECTED_USERNAME) {
    throw new UpstreamError('ACCOUNT_MISMATCH', 'The token belongs to a different Instagram account than INSTAGRAM_EXPECTED_USERNAME.');
  }
  return {
    accountName: body.username,
    accountId: String(body.user_id || body.id || ''),
    followerCount: followers,
  };
}

// ---------- Cache with a single in-flight request ----------
const state = { data: null, lastAttempt: 0, lastError: null, inflight: null };

async function refresh() {
  state.lastAttempt = Date.now();
  try {
    const r = await fetchFresh();
    state.data = {
      ...r,
      updatedAt: new Date().toISOString(),
      source: 'Instagram API with Instagram Login (official, graph.instagram.com)',
      isEstimate: false, // exact value from the official API
    };
    state.lastError = null;
  } catch (err) {
    state.lastError = { code: err.code || 'UNKNOWN', message: err.message || 'Unknown error.' };
    console.error('Refresh failed:', state.lastError.code, state.lastError.message);
  } finally {
    state.inflight = null;
  }
}

async function getSnapshot() {
  const now = Date.now();
  const fresh = state.data && now - Date.parse(state.data.updatedAt) < CACHE_MS;
  const coolingDown = state.lastError && now - state.lastAttempt < RETRY_AFTER_FAILURE_MS;
  if (!fresh && !coolingDown) {
    if (!state.inflight) state.inflight = refresh();
    await state.inflight;
  }
  return { data: state.data, error: state.lastError };
}

// ---------- App ----------
const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

app.get('/api/followers', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { data, error } = await getSnapshot();
  if (data) {
    return res.json({
      ...data,
      stale: Boolean(error),
      error,
      cacheAgeSeconds: Math.round((Date.now() - Date.parse(data.updatedAt)) / 1000),
    });
  }
  res.status(503).json({
    accountName: null, accountId: null, followerCount: null, updatedAt: null,
    source: null, isEstimate: null, stale: false,
    error: error || { code: 'UNKNOWN', message: 'No data available.' },
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));

if (require.main === module) {
  const server = app.listen(PORT, HOST, () => console.log(`Listening on http://${HOST}:${PORT}`));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { app };
