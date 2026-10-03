// Things only a strain's owner can do, proven by signing a message with their wallet (no transaction, no fee):
//   withdraw  → take unused fuel back to your wallet
//   pause / resume / interval → for strains you own alone (bred strains run on their parents' settings)
const { wrap, sb, fn, json, bad, parse, CORS, decrypt } = require('../engine/db');
const { verify, message } = require('../engine/sign');
const { isWallet } = require('../engine/pay');
const { cfg } = require('../engine/cfg');
const { launchWallet, keypair } = require('../engine/wallet');

exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  const { wallet, action, params = {}, ts, signature } = parse(event);
  if (!isWallet(wallet)) return bad('Connect your wallet');
  if (!['withdraw', 'pause', 'resume', 'interval'].includes(action)) return bad('Unknown action');
  if (!(Math.abs(Date.now() - +ts) < 10 * 60e3)) return bad('That signature is too old. Try again.');
  if (!verify(wallet, message(wallet, action, params, ts), String(signature || ''))) return bad('Signature check failed', 401);
  const row = (await sb(`st_wallets?wallet=eq.${wallet}&select=last_action_ts`))[0];
  // each signature works once
  const used = await sb(`st_wallets?wallet=eq.${wallet}&last_action_ts=lt.${+ts}`, { method: 'PATCH', body: { last_action_ts: +ts } });
  if (!row || !used.length) return bad('That signature was already used. Try again.');
  const K = cfg();

  if (action === 'withdraw') {
    const sol = Math.floor(+params.sol * 1e6) / 1e6;
    if (!(sol >= 0.001)) return bad('Enter an amount');
    const ok = await fn('st_charge', { p_owners: [{ wallet, share: 1 }], p_sol: sol });
    if (!ok) return bad('You do not have that much fuel');
    try {
      const W = require('@solana/web3.js'), conn = new W.Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const kp = keypair(await launchWallet(false));
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = new W.Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }), W.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new W.PublicKey(wallet), lamports: Math.round(sol * 1e9) }));
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
      // wait for it (simple polling, no websockets needed)
      // the SOL is already sent at this point, so only an on-chain failure gives the fuel back
      let failed = false;
      for (let i = 0; i < 7; i++) { await new Promise((r) => setTimeout(r, 1000)); try { const st = (await conn.getSignatureStatuses([sig])).value[0]; if (st && st.err) { failed = true; break; } if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) break; } catch {} }
      if (failed) throw new Error('transfer failed on-chain');
      return json(200, { ok: true, sent: sol, signature: sig });
    } catch (e) { await fn('st_add_fuel', { p_wallet: wallet, p_sol: sol, p_deposit: false }); return bad('Withdraw failed, your fuel is untouched: ' + e.message.slice(0, 120), 500); }
  }
  const s = (await sb(`st_strains?id=eq.${encodeURIComponent(params.id)}&status=eq.alive&select=*`))[0];
  if (!s) return bad('Strain not found or not alive');
  if (!(s.owners.length === 1 && s.owners[0].wallet === wallet)) return bad('Only a strain you own alone can be changed. Bred strains run on their own.');
  if (action === 'pause') await sb(`st_strains?id=eq.${s.id}`, { method: 'PATCH', body: { paused: true } });
  if (action === 'resume') await sb(`st_strains?id=eq.${s.id}`, { method: 'PATCH', body: { paused: false, next_launch_at: new Date(Date.now() + 60e3).toISOString() } });
  if (action === 'interval') { const m = Math.round(+params.minutes); if (!(m >= K.minInterval && m <= K.maxInterval)) return bad(`Pick between ${K.minInterval} and ${K.maxInterval} minutes`); await sb(`st_strains?id=eq.${s.id}`, { method: 'PATCH', body: { interval_min: m } }); }
  return json(200, { ok: true });
});
