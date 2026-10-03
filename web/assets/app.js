// Strains: shared helpers for the app pages: wallet (Phantom), API calls, signing, formatting, the top bar.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (w) => (w ? w.slice(0, 4) + '…' + w.slice(-4) : '');
  const sol = (n, d = 4) => (+n || 0).toFixed(d).replace(/\.?0+$/, '') || '0';
  const usd = (n) => (!n ? '—' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n));
  const ago = (t) => { if (!t) return ''; const s = (Date.now() - new Date(t)) / 1000; if (s < 0) return 'soon'; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
  const until = (t) => { const s = Math.max(0, (new Date(t) - Date.now()) / 1000); return s < 60 ? 'under a minute' : s < 3600 ? Math.round(s / 60) + 'm' : Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm'; };
  const every = (m) => (m === 1 ? 'minute' : m < 60 ? m + ' min' : m % 60 ? (m / 60).toFixed(1) + 'h' : m / 60 === 1 ? 'hour' : m / 60 + 'h');
  let tt;
  function toast(msg, bad) { let t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.className = 'toast on' + (bad ? ' bad' : ''); clearTimeout(tt); tt = setTimeout(() => (t.className = 'toast' + (bad ? ' bad' : '')), bad ? 6000 : 3200); }
  async function api(path, body) {
    const r = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.error || 'Something went wrong (' + r.status + ')');
    return j;
  }
  // base58 for signatures
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes) { let d = [0]; for (const b of bytes) { let c = b; for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } } let o = ''; for (const b of bytes) { if (b === 0) o += '1'; else break; } for (let i = d.length - 1; i >= 0; i--) o += A[d[i]]; return o; }

  const provider = () => (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom ? window.solana : null);
  let WALLET = null; const listeners = [];
  function setWallet(w) { WALLET = w; try { w ? localStorage.setItem('st_w', w) : localStorage.removeItem('st_w'); } catch {} document.querySelectorAll('[data-wallet]').forEach((b) => (b.textContent = w ? short(w) : 'Connect')); listeners.forEach((f) => f(w)); }
  async function connect(silent) {
    const p = provider();
    if (!p) { if (silent) return null; if (/Android|iPhone|iPad/i.test(navigator.userAgent)) { location.href = 'https://phantom.app/ul/browse/' + encodeURIComponent(location.href) + '?ref=' + encodeURIComponent(location.origin); return null; } window.open('https://phantom.app/', '_blank'); toast('Install Phantom, then come back'); return null; }
    try { const r = await p.connect(silent ? { onlyIfTrusted: true } : undefined); setWallet(r.publicKey.toString()); return WALLET; } catch { if (!silent) toast('Connection cancelled'); return null; }
  }
  async function payTx(b58msg) { const { signature } = await provider().request({ method: 'signAndSendTransaction', params: { message: b58msg } }); return signature; }
  // the exact text lib/sign.js checks
  const message = (wallet, action, params, ts) => `Strains\naction: ${action}\n${Object.keys(params || {}).sort().map((k) => `${k}: ${params[k]}`).join('\n')}\nwallet: ${wallet}\nts: ${ts}`;
  async function signed(action, params) {
    if (!WALLET && !(await connect())) throw new Error('Connect your wallet');
    const ts = Date.now(); const msg = message(WALLET, action, params, ts);
    const r = await provider().signMessage(new TextEncoder().encode(msg), 'utf8');
    return api('action', { wallet: WALLET, action, params, ts, signature: b58(r.signature || r) });
  }
  function creature(genome, opts = {}) { return window.Creature ? Creature.svg(genome, { id: 'c' + Math.random().toString(36).slice(2, 7), ...opts }) : ''; }
  // the top bar's wallet button
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-wallet]').forEach((b) => b.addEventListener('click', () => (WALLET ? (location.href = '/me') : connect())));
    connect(true);
    const mk = document.querySelectorAll('.mk[data-mark]'); if (mk.length && window.Creature) mk.forEach((m) => (m.innerHTML = Creature.svg({ body: 0, eyes: 1, mouth: 0, top: 1, pattern: 0, limbs: 0, hue: 88, hue2: 300, size: 2 }, { id: 'mk' })));
  });
  window.ST = { $, esc, short, sol, usd, ago, until, every, toast, api, connect, payTx, signed, creature, get wallet() { return WALLET; }, onWallet: (f) => listeners.push(f) };
})();
