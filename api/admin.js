// Your admin tools. Operator tools: /api/admin?key=ADMIN_KEY&action=...
//   setup   → creates the launch wallet and the burn wallet (once). Send the launch wallet ~0.05 SOL for gas.
//   status  → both wallets with balances, totals owed, counts, AI spend, last runs
//   tick / cycle / money → run that job right now
//   kill&slug=x  → kill a strain now (e.g. one launching offensive coins)
//   withdraw&sol=x → send spare SOL (left over from launch costs) to OWNER_WALLET to pay your AI bill.
//                    It can never touch users' fuel or fees they're owed.
const { wrap, sb, json, bad, getState } = require('../engine/db');
const { launchWallet, burnWallet, balanceSol } = require('../engine/wallet');
exports.handler = wrap(async (event) => {
  const q = event.queryStringParameters || {};
  if (!process.env.ADMIN_KEY || q.key !== process.env.ADMIN_KEY) return bad('Nope', 401);
  switch (q.action) {
    case 'setup': {
      const had = [await launchWallet(false), await burnWallet(false)];
      const [lw, bw] = [await launchWallet(true), await burnWallet(true)];
      return json(200, { created: { launch: !had[0], burn: !had[1] }, launch_wallet: lw.pub, burn_wallet: bw.pub, next: 'Send about 0.05 SOL to the launch wallet for network fees. Nothing needs to go to the burn wallet.' });
    }
    case 'status': {
      const [lw, bw] = [await launchWallet(false), await burnWallet(false)];
      const wallets = await sb('st_wallets?select=fuel_sol,owed_sol,paid_sol&limit=100000');
      const sum = (k) => +wallets.reduce((a, w) => a + +w[k], 0).toFixed(6);
      const alive = (await sb('st_strains?status=eq.alive&select=id')).length;
      const queue = await sb('st_coins?status=in.(new,concept,imaged)&select=name,status,attempts,error');
      const failed = await sb('st_coins?status=eq.failed&order=created_at.desc&limit=5&select=name,error,created_at');
      const lwBal = lw ? await balanceSol(lw.pub) : 0;
      return json(200, { launch_wallet: lw && lw.pub, launch_balance: lwBal, burn_wallet: bw && bw.pub, burn_balance: bw ? await balanceSol(bw.pub) : 0,
        users_fuel_sol: sum('fuel_sol'), users_owed_sol: sum('owed_sol'), paid_out_sol: sum('paid_sol'), spare_sol: +(lwBal - sum('fuel_sol') - sum('owed_sol')).toFixed(6),
        alive, queue, recent_failures: failed, ai: await getState('ai_usage', null), last_cycle: await getState('last_cycle', null), last_money: await getState('last_money', null), burns: await getState('burn_totals', null), unallocated_sol: await getState('unallocated_sol', 0) });
    }
    case 'tick': return json(200, { log: await require('../engine/launcher').tick(+q.ms || 9000) });
    case 'cycle': return json(200, { log: await require('../engine/cycle').cycle() });
    case 'money': return json(200, { log: await require('../engine/money').money() });
    case 'kill': {
      const s = (await sb(`st_strains?slug=eq.${encodeURIComponent(String(q.slug || ''))}&status=eq.alive&select=*`))[0]; if (!s) return bad('No living strain by that name');
      await sb(`st_strains?id=eq.${s.id}`, { method: 'PATCH', body: { status: 'dead', died_at: new Date().toISOString(), death_note: 'Removed by the lab.' } });
      await require('../engine/launcher').ev('death', s, null, `${s.name} was removed from the lab.`);
      return json(200, { ok: true });
    }
    case 'withdraw': {
      const to = process.env.OWNER_WALLET; if (!to) return bad('Set OWNER_WALLET first');
      const lw = await launchWallet(false); if (!lw) return bad('Run setup first');
      const wallets = await sb('st_wallets?select=fuel_sol,owed_sol&limit=100000');
      const owedToUsers = wallets.reduce((a, w) => a + +w.fuel_sol + +w.owed_sol, 0) + (await getState('unallocated_sol', 0));
      const spare = (await balanceSol(lw.pub)) - owedToUsers - 0.03, sol = +q.sol;
      if (!(sol > 0) || sol > spare) return bad(`You can withdraw up to ${Math.max(0, spare).toFixed(4)} SOL (everything above users' fuel and fees, keeping 0.03 for gas)`);
      const W = require('@solana/web3.js'), conn = new W.Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
      const kp = require('../engine/wallet').keypair(lw);
      const tx = new W.Transaction().add(W.SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new W.PublicKey(to), lamports: Math.round(sol * 1e9) }));
      const { blockhash } = await conn.getLatestBlockhash('confirmed'); tx.recentBlockhash = blockhash; tx.feePayer = kp.publicKey; tx.sign(kp);
      return json(200, { sent_sol: sol, to, signature: await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 }) });
    }
    default: return bad('Unknown action. Use setup, status, tick, cycle, money, kill or withdraw.');
  }
});
