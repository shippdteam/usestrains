// Step 2: check the payment landed, add the fuel, render the creature, and bring it to life.
const { wrap, sb, fn, json, bad, parse, CORS, now } = require('../engine/db');
const { launchWallet, burnWallet } = require('../engine/wallet');
const { verify } = require('../engine/pay');
const { storeAvatar } = require('../engine/art');
const { ev } = require('../engine/launcher');

exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return bad('POST only', 405);
  const { id, signature } = parse(event);
  if (!id || !signature) return bad('Missing strain or payment');
  const s = (await sb(`st_strains?id=eq.${encodeURIComponent(id)}&select=*`))[0];
  if (!s) return bad('Strain not found', 404);
  if (s.status === 'alive') return json(200, { slug: s.slug, already: true });
  // an expired draft still comes to life if its payment is real (its name may need a new web address)
  if (!(s.status === 'pending' || (s.status === 'failed' && !s.pay_sig))) return bad('This draft can no longer be used. Start again.');
  const [lw, bw] = await Promise.all([launchWallet(false), burnWallet(false)]);
  const expect = [{ to: lw.pub, sol: +s.fuel_paid_sol }]; if (+s.paid_sol > 0) expect.push({ to: bw.pub, sol: +s.paid_sol });
  try { await verify(signature, s.creator_wallet, expect); } catch (e) { return bad(e.message); }
  // a payment can only ever be used once
  try { await sb('st_deposits', { method: 'POST', body: { sig: signature, wallet: s.creator_wallet, sol: +s.fuel_paid_sol + +s.paid_sol, kind: 'strain' }, headers: { Prefer: 'return=minimal' } }); }
  catch { return bad('That payment was already used'); }
  await fn('st_add_fuel', { p_wallet: s.creator_wallet, p_sol: +s.fuel_paid_sol, p_deposit: true });
  if (!(+s.paid_sol > 0)) {
    // the free strain: claim it exactly once, even if two tabs race
    const got = await sb(`st_wallets?wallet=eq.${s.creator_wallet}&free_used=is.false`, { method: 'PATCH', body: { free_used: true } });
    if (!got.length) { await sb(`st_strains?id=eq.${s.id}`, { method: 'PATCH', body: { status: 'failed', pay_sig: signature, error: 'free strain already used' } }); return bad(`This wallet already used its free strain, so this one needs ${require('../engine/cfg').cfg().strainPrice} SOL. Your fuel (${s.fuel_paid_sol} SOL) was added to your balance.`); }
  } else await sb(`st_wallets?wallet=eq.${s.creator_wallet}`, { method: 'PATCH', body: { free_used: true } });
  let avatar_url = null; try { avatar_url = await storeAvatar(s); } catch (e) { console.error('avatar', e.message); }
  const slug = s.status === 'failed' ? await require('../engine/cycle').uniqueSlug(s.name) : s.slug; s.slug = slug;
  await sb(`st_strains?id=eq.${s.id}`, { method: 'PATCH', body: { status: 'alive', slug, error: null, pay_sig: signature, avatar_url, born_at: now(), next_launch_at: new Date(Date.now() + 2 * 60e3).toISOString() } });
  await ev('birth', s, null, `${s.name} entered the lab${+s.paid_sol > 0 ? ` (${s.paid_sol} SOL sent to the burn wallet)` : ''}`, { creator: s.creator_wallet, paid: +s.paid_sol });
  return json(200, { slug: s.slug });
});
