// Step 1 of making a strain: check the creature and settings, reserve its name, and build the payment
// (its first fuel → launch wallet, plus 1 SOL → burn wallet if this wallet already used its free strain).
const { wrap, sb, json, bad, parse, CORS, now } = require('../engine/db');
const { cfg, VIBES } = require('../engine/cfg');
const C = require('../web/assets/creature.js');
const { launchWallet, burnWallet } = require('../engine/wallet');
const { build, isWallet } = require('../engine/pay');
const { uniqueSlug } = require('../engine/cycle');

exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const K = cfg(), b = parse(event);
  const wallet = String(b.wallet || '').trim();
  const name = String(b.name || '').replace(/[^\p{L}\p{N} '-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 18);
  const persona = String(b.persona || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 280);
  const vibes = [...new Set((Array.isArray(b.vibes) ? b.vibes : []).filter((v) => VIBES.includes(v)))].slice(0, 3);
  const interval = Math.round(+b.interval), devBuy = Math.round(+b.devBuy * 1e4) / 1e4, fuel = Math.round(+b.fuel * 1e4) / 1e4;
  if (!isWallet(wallet)) return bad('Connect your wallet first');
  if (name.length < 2) return bad('Give your creature a name (2 to 18 letters)');
  if (!(interval >= K.minInterval && interval <= K.maxInterval)) return bad(`Launch time must be between ${K.minInterval} and ${K.maxInterval} minutes`);
  if (!(devBuy >= 0 && devBuy <= K.maxDevBuy)) return bad(`Dev buy must be between 0 and ${K.maxDevBuy} SOL`);
  if (!(fuel >= K.minFuel) || fuel > 100) return bad(`Fuel must be at least ${K.minFuel} SOL`);
  if (!vibes.length && persona.length < 10) return bad('Pick at least one theme or describe its personality');
  const genome = C.clean(b.genome || {});
  const [lw, bw] = await Promise.all([launchWallet(false), burnWallet(false)]);
  if (!lw || !bw) return bad('Strains opens soon (the wallets are not set up yet).', 503);

  const me = (await sb(`st_wallets?wallet=eq.${wallet}&select=free_used`))[0];
  const paid = !!(me && me.free_used) || (await sb(`st_strains?creator_wallet=eq.${wallet}&status=in.(alive,dead)&select=id&limit=1`)).length > 0;
  const price = paid ? K.strainPrice : 0;
  // only one unpaid draft at a time per wallet, and drafts expire after 30 minutes
  await sb(`st_strains?status=eq.pending&or=(creator_wallet.eq.${wallet},created_at.lt.${new Date(Date.now() - 30 * 60e3).toISOString()})`, { method: 'PATCH', body: { status: 'failed' } });

  const [row] = await sb('st_strains', { method: 'POST', body: { status: 'pending', slug: await uniqueSlug(name), name, persona, vibes, genome, creator_wallet: wallet, owners: [{ wallet, share: 1 }], interval_min: interval, dev_buy_sol: devBuy, generation: 0, paid_sol: price, fuel_paid_sol: fuel } });
  const transfers = [{ to: lw.pub, sol: fuel }]; if (price > 0) transfers.push({ to: bw.pub, sol: price });
  let payMessage; try { payMessage = await build(wallet, transfers); } catch (e) { return bad('Could not build the payment: ' + e.message, 500); }
  return json(200, { id: row.id, slug: row.slug, price, fuel, total: +(price + fuel).toFixed(4), launch_wallet: lw.pub, burn_wallet: bw.pub, payMessage });
});
