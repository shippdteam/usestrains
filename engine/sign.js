// Checks a message signed by a Solana wallet (Phantom's signMessage), with node's own ed25519. No extra packages.
const crypto = require('crypto');
const { b58decode } = require('./solana');
function verify(wallet, message, sigB58) {
  try {
    const pub = Buffer.from(b58decode(wallet)); if (pub.length !== 32) return false;
    const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') }, format: 'jwk' });
    return crypto.verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(b58decode(sigB58)));
  } catch { return false; }
}
// the exact text the site asks the wallet to sign
const message = (wallet, action, params, ts) => `Strains\naction: ${action}\n${Object.keys(params || {}).sort().map((k) => `${k}: ${params[k]}`).join('\n')}\nwallet: ${wallet}\nts: ${ts}`;
module.exports = { verify, message };
