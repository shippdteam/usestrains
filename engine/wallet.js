// Strains has two server wallets, both created by the server through PumpPortal and stored encrypted (WALLET_SECRET):
//   launch wallet → creates every coin (so it collects the creator fees), holds strains' fuel, pays out fees
//   burn wallet   → receives the 1 SOL paid for every extra strain, buys $STRAINS with it and burns it
// They are kept apart so burn money and launch money can never mix.
const { getState, setState, encrypt, decrypt, balanceSol } = require('./db');
const { createWallet, b58decode } = require('./solana');

async function wallet(kind, create = false) {
  const key = kind + '_wallet';
  let w = await getState(key, null);
  if (!w && create) {
    const n = await createWallet();
    w = { pub: n.walletPublicKey, escrow_api_key: encrypt(n.apiKey), escrow_private_key: encrypt(n.privateKey), created_at: new Date().toISOString() };
    await setState(key, w);
  }
  return w || null;
}
const launchWallet = (create) => wallet('launch', create);
const burnWallet = (create) => wallet('burn', create);
function keypair(w) { const W = require('@solana/web3.js'); return W.Keypair.fromSecretKey(b58decode(decrypt(w.escrow_private_key))); }
const apiKey = (w) => decrypt(w.escrow_api_key);
module.exports = { launchWallet, burnWallet, keypair, apiKey, balanceSol };
