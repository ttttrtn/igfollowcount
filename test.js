'use strict';
// Spins up a fake Instagram API and checks success, mismatch, bad token, and bad response handling.
const http = require('http');
const assert = require('assert');
let mode = 'ok';
const fake = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (mode === 'ok') return res.end(JSON.stringify({ user_id: '123', username: 'TestUser', followers_count: 4321 }));
  if (mode === 'badtoken') { res.statusCode = 400; return res.end(JSON.stringify({ error: { code: 190, message: 'expired' } })); }
  if (mode === 'rate') { res.statusCode = 400; return res.end(JSON.stringify({ error: { code: 4, message: 'limit' } })); }
  res.end(JSON.stringify({ username: 'TestUser' })); // missing followers_count
});
fake.listen(0, async () => {
  process.env.INSTAGRAM_API_BASE = 'http://127.0.0.1:' + fake.address().port;
  process.env.INSTAGRAM_ACCESS_TOKEN = 'SECRET_TOKEN_123';
  process.env.INSTAGRAM_EXPECTED_USERNAME = '@testuser';
  process.env.CACHE_SECONDS = '0.001';
  const { app } = require('./server');
  const srv = app.listen(0);
  const get = async () => { const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/followers`); return { s: r.status, b: await r.json() }; };
  let r = await get();
  assert.strictEqual(r.s, 200); assert.strictEqual(r.b.followerCount, 4321); assert.strictEqual(r.b.isEstimate, false);
  console.log('success ok:', r.b.accountName, r.b.followerCount);
  mode = 'badtoken'; // retry cooldown means stale cached data is served with an error
  await new Promise(x => setTimeout(x, 10));
  r = await get();
  assert.strictEqual(r.s, 200); assert.strictEqual(r.b.stale, true); assert.strictEqual(r.b.followerCount, 4321);
  assert.ok(!JSON.stringify(r.b).includes('SECRET_TOKEN_123'));
  console.log('stale-on-failure ok:', r.b.error.code);
  fake.close(); srv.close(); console.log('All tests passed'); process.exit(0);
});
