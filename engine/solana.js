// Tiny zero-dependency helpers: base58, ed25519 keypairs in Solana's 64-byte format, PumpPortal calls.
const crypto = require('crypto');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
  let digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const b of buf) { if (b === 0) out += '1'; else break; }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

function b58decode(str) {
  const bytes = [0];
  for (const ch of str) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('Bad base58');
    let carry = v;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of str) { if (ch === '1') bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

// Returns { publicKey (base58), secretKey (base58 of 64 bytes seed+pub) } like @solana/web3.js Keypair.
function newKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  return { publicKey: b58encode(pub), secretKey: b58encode(Buffer.concat([seed, pub])) };
}

const PP = 'https://pumpportal.fun/api';

async function createWallet() {
  const r = await fetch(PP + '/create-wallet');
  if (!r.ok) throw new Error('PumpPortal create-wallet failed: ' + r.status);
  const j = await r.json(); // { apiKey, walletPublicKey, privateKey }
  if (!j.apiKey || !j.walletPublicKey) throw new Error('PumpPortal returned no wallet');
  return j;
}

async function uploadMetadata({ imageBuffer, imageType, name, symbol, description, website, twitter, telegram }) {
  const fd = new FormData();
  fd.append('file', new Blob([imageBuffer], { type: imageType || 'image/png' }), 'coin.png');
  fd.append('name', name);
  fd.append('symbol', symbol);
  fd.append('description', description || '');
  if (twitter) fd.append('twitter', twitter);
  if (telegram) fd.append('telegram', telegram);
  if (website) fd.append('website', website);
  fd.append('showName', 'true');
  const r = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: fd });
  const t = await r.text();
  if (!r.ok) throw new Error('pump.fun metadata upload failed: ' + r.status + ' ' + t.slice(0, 200));
  const j = JSON.parse(t);
  if (!j.metadataUri) throw new Error('No metadataUri from pump.fun');
  return j.metadataUri;
}

async function ppTrade(apiKey, body) {
  const r = await fetch(PP + '/trade?api-key=' + encodeURIComponent(apiKey), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  const errs = Array.isArray(j.errors) ? j.errors : (j.errors ? [j.errors] : []);
  // PumpPortal returns errors: [] on success — only a non-empty list is a real error
  if (!r.ok || errs.length || j.error) throw new Error('PumpPortal: ' + (errs.length ? JSON.stringify(errs) : j.error || t.slice(0, 200)));
  return j;
}

async function createCoin({ apiKey, name, symbol, metadataUri, devBuySol, priorityFee, mint }) {
  mint = mint || newKeypair();
  const res = await ppTrade(apiKey, {
    action: 'create',
    tokenMetadata: { name, symbol, uri: metadataUri },
    mint: mint.secretKey,
    denominatedInSol: 'true',
    amount: devBuySol,
    slippage: 15,
    priorityFee: priorityFee,
    pool: 'pump',
  });
  return { mint: mint.publicKey, signature: res.signature };
}

async function collectCreatorFee(apiKey) {
  return ppTrade(apiKey, { action: 'collectCreatorFee', priorityFee: 0.00005, pool: 'pump' });
}

module.exports = { b58encode, b58decode, newKeypair, createWallet, uploadMetadata, ppTrade, createCoin, collectCreatorFee };
