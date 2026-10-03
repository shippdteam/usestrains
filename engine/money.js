// The hourly money run, at half past:
//   1. collect the creator fees every Strains coin earned (they all land in the launch wallet)
//   2. split them to coins by their share of the hour's trading → to each strain's owners (a bred strain: 50/50)
//   3. pay out every wallet that's owed enough, straight to their wallet
//   4. burn wallet: buy $STRAINS with what new strains paid, and burn it
// Strains itself takes no cut of any coin's fees.
const { sb, fn, now, getState, setState, balanceSol } = require('./db');
const { cfg } = require('./cfg');
const { launchWallet, burnWallet, keypair, apiKey } = require('./wallet');
const { ev } = require('./launcher');
const RPC = () => process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const upsert = (table, rows) => rows.length ? sb(table + '?on_conflict=id', { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }) : null;

async function collect(log) {
  const w = await launchWallet(false); if (!w) return 0;
  // only count fees that really arrived, so payouts can never dip into anyone's fuel
  const before = await balanceSol(w.pub);
  const r = await require('./collect').collectAll(w);
  let got = 0;
  if (r.sig && r.confirmed) got = (+r.curve_sol || 0) + (+r.amm_sol || 0);
  else if (r.sig || (r.steps || []).some((s) => /pumpportal collect/.test(s))) got = Math.max(0, Math.min((+r.curve_sol || 0) + (+r.amm_sol || 0), (await balanceSol(w.pub)) - before));
  log.push(`collected ${got.toFixed(5)} SOL (${(r.steps || []).join(', ')})`);
  return got;
}

async function allocate(sol, log) {
  const pending = (await getState('unallocated_sol', 0)) + sol;
  if (!(pending > 0)) return;
  // the hour's trading decides who earned what (creator fees are a fixed % of volume)
  let coins = await sb('st_coins?status=eq.live&vol_h1=gt.0&select=id,strain_id,vol_h1,fees_sol&limit=5000');
  let key = 'vol_h1';
  if (!coins.length) { coins = await sb('st_coins?status=eq.live&vol_h24=gt.0&select=id,strain_id,vol_h24,fees_sol&limit=5000'); key = 'vol_h24'; }
  const total = coins.reduce((a, c) => a + +c[key], 0);
  if (!(total > 0)) { await setState('unallocated_sol', pending); log.push(`holding ${pending.toFixed(5)} SOL until there's volume to split it by`); return; }
  const strains = {}; for (const s of await sb(`st_strains?id=in.(${[...new Set(coins.map((c) => c.strain_id))].join(',')})&select=id,owners,fees_sol`)) strains[s.id] = s;
  const owed = {}, coinRows = [], strainAdd = {};
  for (const c of coins) {
    const part = (pending * +c[key]) / total; if (!(part > 0)) continue;
    coinRows.push({ id: c.id, fees_sol: +(+c.fees_sol + part).toFixed(9) });
    strainAdd[c.strain_id] = (strainAdd[c.strain_id] || 0) + part;
    for (const o of (strains[c.strain_id] || {}).owners || []) owed[o.wallet] = (owed[o.wallet] || 0) + part * o.share;
  }
  await upsert('st_coins', coinRows);
  await upsert('st_strains', Object.entries(strainAdd).map(([id, add]) => ({ id, fees_sol: +((+(strains[id] || {}).fees_sol || 0) + add).toFixed(9) })));
  for (const [wallet, v] of Object.entries(owed)) await fn('st_add_owed', { p_wallet: wallet, p_sol: +v.toFixed(9) });
  await setState('unallocated_sol', 0);
  const t = await getState('fee_totals', { sol: 0 }); t.sol += pending; t.at = now(); await setState('fee_totals', t);
  log.push(`split ${pending.toFixed(5)} SOL across ${coinRows.length} coins → ${Object.keys(owed).length} wallets`);
}

async function payout(log) {
  const K = cfg(), w = await launchWallet(false); if (!w) return;
  const due = await sb(`st_wallets?owed_sol=gte.${K.payoutMin}&order=owed_sol.desc&limit=40&select=wallet,owed_sol`);
  if (!due.length) return;
  const W = require('@solana/web3.js'), conn = new W.Connection(RPC(), 'confirmed'), kp = keypair(w);
  // everyone's fuel sits in the same wallet: payouts may only use what's left above it
  const fuel = (await sb('st_wallets?fuel_sol=gt.0&select=fuel_sol&limit=100000')).reduce((a, x) => a + +x.fuel_sol, 0);
  for (let i = 0; i < due.length; i += 12) {
    const batch = due.slice(i, i + 12).map((d) => ({ wallet: d.wallet, sol: Math.floor(+d.owed_sol * 1e9) / 1e9 }));
    const sum = batch.reduce((a, b) => a + b.sol, 0);
    if ((await conn.getBalance(kp.publicKey, 'confirmed')) / 1e9 - fuel < sum + 0.01) { log.push('payout paused: launch wallet balance too low'); break; }
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new W.Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }), ...batch.map((b) => W.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new W.PublicKey(b.wallet), lamports: Math.round(b.sol * 1e9) })));
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
    let ok = false; for (let k = 0; k < 15 && !ok; k++) { await new Promise((r) => setTimeout(r, 1000)); const s = (await conn.getSignatureStatuses([sig])).value[0]; if (s && s.err) break; ok = !!(s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')); }
    if (!ok) { log.push('payout not confirmed ' + sig); break; }
    for (const b of batch) await fn('st_mark_paid', { p_wallet: b.wallet, p_sol: b.sol });
    await ev('payout', null, null, `Paid ${sum.toFixed(4)} SOL in creator fees to ${batch.length} wallet${batch.length > 1 ? 's' : ''}`, { sig, wallets: batch.length, sol: sum });
    log.push(`paid ${sum.toFixed(4)} SOL to ${batch.length}`);
  }
}

// What new strains paid (1 SOL each) → buy $STRAINS → burn it. All from the burn wallet, nothing else touches it.
async function burn(log) {
  const K = cfg(), w = await burnWallet(false); if (!w) return;
  const bal = await balanceSol(w.pub);
  if (!K.mint) { if (bal > 0.01) log.push(`burn wallet holds ${bal.toFixed(3)} SOL, waiting for STRAINS_MINT`); return; }
  const spend = Math.floor((bal - 0.015) * 1e4) / 1e4;
  const W = require('@solana/web3.js'), T = require('@solana/spl-token'), conn = new W.Connection(RPC(), 'confirmed'), kp = keypair(w), mint = new W.PublicKey(K.mint);
  let buySig = null;
  if (spend >= K.burnMin) {
    const { ppTrade } = require('./solana');
    const r = await ppTrade(apiKey(w), { action: 'buy', mint: K.mint, denominatedInSol: 'true', amount: spend, slippage: 15, priorityFee: K.priorityFee, pool: 'auto' });
    buySig = r.signature; log.push(`bought $STRAINS with ${spend} SOL`);
    for (let k = 0; k < 12; k++) { await new Promise((r) => setTimeout(r, 1000)); const s = (await conn.getSignatureStatuses([buySig])).value[0]; if (s && (s.err || s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) break; }
  }
  // burn every $STRAINS the burn wallet holds (from this buy or any earlier one)
  const info = await conn.getAccountInfo(mint, 'confirmed'); if (!info) return;
  const pid = info.owner, ata = T.getAssociatedTokenAddressSync(mint, kp.publicKey, false, pid);
  let amount = 0n, decimals = 6, ui = '0';
  try { const b = await conn.getTokenAccountBalance(ata, 'confirmed'); amount = BigInt(b.value.amount); decimals = b.value.decimals; ui = b.value.uiAmountString; } catch {}
  if (amount === 0n) return;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new W.Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }), T.createBurnCheckedInstruction(ata, mint, kp.publicKey, amount, decimals, [], pid));
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
  const t = await getState('burn_totals', { sol: 0, tokens: 0, burns: 0 });
  t.sol += buySig ? spend : 0; t.tokens += +ui; t.burns += 1; t.last = { at: now(), sig, buy: buySig, tokens: +ui, sol: buySig ? spend : 0 };
  await setState('burn_totals', t);
  await ev('burn', null, null, `Burned ${(+ui).toLocaleString('en-US', { maximumFractionDigits: 0 })} $STRAINS${buySig ? ` bought with ${spend} SOL from new strains` : ''}`, { sig, buy: buySig, tokens: +ui, sol: buySig ? spend : 0 });
  log.push(`burned ${ui} $STRAINS`);
}

async function money() {
  const log = [];
  for (const [name, step] of [['collect', null], ['payout', payout], ['burn', burn]]) {
    try {
      if (name === 'collect') { const got = await collect(log); await allocate(got, log); }
      else await step(log);
    } catch (e) { log.push(name + ' failed: ' + String(e.message).slice(0, 140)); }
  }
  await setState('last_money', { at: now(), log });
  return log;
}
module.exports = { money, allocate, payout, burn };
