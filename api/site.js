// Public settings and live numbers for the pages.
const { wrap, json, sb, getState } = require('../engine/db');
const { cfg, VIBES } = require('../engine/cfg');
const { launchWallet, burnWallet } = require('../engine/wallet');
exports.handler = wrap(async () => {
  const K = cfg(); const [lw, bw] = await Promise.all([launchWallet(false), burnWallet(false)]);
  const count = async (q) => { try { return (await sb(q + '&select=id&limit=10000')).length; } catch { return 0; } };
  const [alive, dead, coins, lastCycle, burns, fees] = await Promise.all([count('st_strains?status=eq.alive'), count('st_strains?status=eq.dead'), count('st_coins?status=eq.live'), getState('last_cycle', null), getState('burn_totals', null), getState('fee_totals', null)]);
  const next = new Date(); next.setUTCMinutes(60, 0, 0);
  return json(200, { ready: !!(lw && bw), launch_wallet: lw && lw.pub, burn_wallet: bw && bw.pub, mint: K.mint || null, x_url: K.xUrl || null,
    price: K.strainPrice, min_fuel: K.minFuel, launch_cost: K.launchCost, intervals: K.intervals, min_interval: K.minInterval, max_interval: K.maxInterval, dev_buys: K.devBuys, max_dev_buy: K.maxDevBuy, vibes: VIBES,
    rules: { grace_hours: K.graceHours, min_population: K.minPopulation, cull_per_hour: K.cullPerHour, breed_per_hour: K.breedPerHour, market_weight: K.marketWeight, payout_min: K.payoutMin },
    alive, dead, coins, next_cycle: next.toISOString(), last_cycle: lastCycle && { at: lastCycle.at, alive: lastCycle.alive }, burns, fees_sol: fees ? fees.sol : 0 });
});
