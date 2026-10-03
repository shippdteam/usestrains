// Payments from a person's wallet: build the transaction for Phantom to sign, then check it on-chain.
const { rpc } = require('./db');
const { b58encode } = require('./solana');
const RPC = () => process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

async function build(from, transfers) {
  const W = require('@solana/web3.js');
  const conn = new W.Connection(RPC(), 'confirmed');
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const fromPk = new W.PublicKey(from);
  const tx = new W.Transaction({ feePayer: fromPk, blockhash, lastValidBlockHeight }).add(W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
  for (const t of transfers) tx.add(W.SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: new W.PublicKey(t.to), lamports: Math.round(t.sol * 1e9) }));
  return b58encode(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

// expect: [{ to, sol }] → returns { [to]: received }
async function verify(sig, from, expect) {
  for (let i = 0; i < 8; i++) {
    const tx = await rpc('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    if (tx) {
      if (tx.meta && tx.meta.err) throw new Error('That payment failed on-chain');
      const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey));
      if (keys[0] !== from) throw new Error('That payment was not sent from your connected wallet');
      const got = {};
      for (const e of expect) {
        const idx = keys.indexOf(e.to); if (idx < 0) throw new Error('That payment did not go to the right wallet');
        got[e.to] = (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9;
        if (got[e.to] + 1e-6 < e.sol) throw new Error(`Payment too small: got ${got[e.to]} SOL, need ${e.sol} SOL`);
      }
      return got;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error('Payment not confirmed yet. Wait a few seconds and try again.');
}
const isWallet = (w) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(w || ''));
module.exports = { build, verify, isWallet };
