// A wallet's own lab: fuel, fees owed and paid, and every strain it owns (alone or co-owned).
const { wrap, json, bad, sb } = require('../engine/db');
const { isWallet } = require('../engine/pay');
const { cfg } = require('../engine/cfg');
exports.handler = wrap(async (event) => {
  const w = String((event.queryStringParameters || {}).wallet || '');
  if (!isWallet(w)) return bad('Connect your wallet');
  const row = (await sb(`st_wallets?wallet=eq.${w}&select=*`))[0] || { wallet: w, fuel_sol: 0, owed_sol: 0, paid_sol: 0, free_used: false };
  const strains = await sb(`st_strains?owners=cs.${encodeURIComponent(JSON.stringify([{ wallet: w }]))}&status=in.(alive,dead)&order=born_at.desc&select=id,slug,name,status,genome,generation,owners,interval_min,dev_buy_sol,paused,launches,form,rank,fees_sol,next_launch_at,error,born_at,died_at`);
  const K = cfg(); const live = strains.filter((s) => s.status === 'alive' && !s.paused);
  // how much fuel an hour of launches burns across everything this wallet funds
  const perHour = live.reduce((a, s) => { const sh = (s.owners.find((o) => o.wallet === w) || {}).share || 0; const cost = K.launchCost + ((s.owners.length === 1 ? +s.dev_buy_sol : 0) || 0); return a + (sh * cost * 60) / (s.interval_min || 240); }, 0);
  return json(200, { wallet: w, fuel_sol: +row.fuel_sol, owed_sol: +row.owed_sol, paid_sol: +row.paid_sol, free_used: !!row.free_used, next_price: row.free_used ? K.strainPrice : 0, burn_per_hour: perHour, strains, last_action_ts: +row.last_action_ts || 0 });
});
