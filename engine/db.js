// Strains: Supabase + helpers shared by all functions. Zero-dependency (uses fetch + node crypto).
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WALLET_SECRET = process.env.WALLET_SECRET || '';

function must(v, name) { if (!v) throw new Error('Missing env var ' + name); return v; }

async function sb(path, { method = 'GET', body, headers = {} } = {}) {
  must(SUPABASE_URL, 'SUPABASE_URL'); must(SERVICE_KEY, 'SUPABASE_SERVICE_KEY');
  const r = await fetch(SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/' + path, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : '',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + (data && data.message ? data.message : text));
  return data;
}

// AES-256-GCM so private keys never sit in plain text in the database.
function key() { return crypto.createHash('sha256').update(must(WALLET_SECRET, 'WALLET_SECRET')).digest(); }
function encrypt(s) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(s), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error('RPC ' + method + ': ' + JSON.stringify(j.error));
  return j.result;
}
async function balanceSol(pubkey) {
  const r = await rpc('getBalance', [pubkey, { commitment: 'confirmed' }]);
  return (r && r.value ? r.value : 0) / 1e9;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
function json(status, obj) { return { statusCode: status, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(obj) }; }
function bad(msg, status = 400) { return json(status, { error: msg }); }
function parse(event) { try { return JSON.parse(event.body || '{}'); } catch { return {}; } }

// Any crash comes back to the site as a readable message instead of a blank 502.
function wrap(fn) {
  return async (event, ctx) => {
    try { return await fn(event, ctx); }
    catch (e) { console.error(e); return json(500, { error: (e && e.message) || String(e) }); }
  };
}

// small key/value store for settings and the wallets
async function getState(key, fallback = null) { const r = await sb(`st_state?key=eq.${encodeURIComponent(key)}&select=value`); return r && r[0] ? r[0].value : fallback; }
async function setState(key, value) { await sb('st_state', { method: 'POST', body: { key, value }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }); return value; }
const SITE = () => (process.env.SITE_URL || 'https://usestrains.fun').replace(/\/$/, '');

// call a database function (supabase.sql)
const fn = (name, args) => sb('rpc/' + name, { method: 'POST', body: args });
const now = () => new Date().toISOString();
module.exports = { fn, now, wrap, sb, encrypt, decrypt, rpc, balanceSol, json, bad, parse, CORS, getState, setState, SITE };
