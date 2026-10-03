// Sends a coin's dev-buy tokens from the launch wallet to the strain's owner. Safe to call again and again:
// it only ever sends what the launch wallet actually holds of that coin.
const { sb } = require('./db');
const { launchWallet, keypair } = require('./wallet');
const RPC = () => process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

async function deliver(c) {
  if (c.tokens_sent || !c.mint || !c.tokens_to) return 'skip';
  const W = require('@solana/web3.js'), T = require('@solana/spl-token');
  const conn = new W.Connection(RPC(), 'confirmed');
  const w = await launchWallet(false); if (!w) return 'no wallet';
  const kp = keypair(w), mint = new W.PublicKey(c.mint), to = new W.PublicKey(c.tokens_to);
  const info = await conn.getAccountInfo(mint, 'confirmed'); if (!info) return 'waiting';
  const pid = info.owner, ata = T.getAssociatedTokenAddressSync(mint, kp.publicKey, false, pid);
  let amount = 0n, decimals = 6;
  try { const b = await conn.getTokenAccountBalance(ata, 'confirmed'); amount = BigInt(b.value.amount); decimals = b.value.decimals; } catch {}
  if (amount === 0n) { if (c.tokens_sig) { await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { tokens_sent: true } }); return 'done'; } return 'waiting'; }
  if (c.tokens_sig && c.tokens_sig_at && Date.now() - new Date(c.tokens_sig_at).getTime() < 45e3) return 'sending';
  const toAta = T.getAssociatedTokenAddressSync(mint, to, false, pid);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new W.Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
    W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 }), W.ComputeBudgetProgram.setComputeUnitLimit({ units: 60000 }),
    T.createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, to, mint, pid),
    T.createTransferCheckedInstruction(ata, mint, toAta, kp.publicKey, amount, decimals, [], pid));
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
  await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { tokens_sig: sig, tokens_sig_at: new Date().toISOString() } });
  return 'sent';
}
module.exports = { deliver };
