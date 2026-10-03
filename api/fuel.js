// Top up fuel, step 2: check the transfer and add it to the wallet's fuel.
const { wrap, sb, fn, json, bad, parse, CORS } = require('../engine/db');
const { launchWallet } = require('../engine/wallet');
const { verify, isWallet } = require('../engine/pay');
exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  const { wallet, signature, sol } = parse(event);
  if (!isWallet(wallet) || !signature) return bad('Missing wallet or payment');
  const lw = await launchWallet(false);
  let got; try { got = (await verify(signature, wallet, [{ to: lw.pub, sol: Math.max(0.01, +sol * 0.999 || 0.01) }]))[lw.pub]; } catch (e) { return bad(e.message); }
  try { await sb('st_deposits', { method: 'POST', body: { sig: signature, wallet, sol: got, kind: 'fuel' }, headers: { Prefer: 'return=minimal' } }); } catch { return bad('That payment was already used'); }
  const fuel = await fn('st_add_fuel', { p_wallet: wallet, p_sol: +got.toFixed(9), p_deposit: true });
  await sb(`st_strains?owners=cs.${encodeURIComponent(JSON.stringify([{ wallet }]))}&error=like.Out of fuel*`, { method: 'PATCH', body: { error: null, next_launch_at: new Date(Date.now() + 60e3).toISOString() } });
  return json(200, { added: got, fuel_sol: fuel });
});
