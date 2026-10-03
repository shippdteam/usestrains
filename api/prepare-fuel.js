// Top up fuel: builds a transfer to the launch wallet for Phantom to sign.
const { wrap, json, bad, parse, CORS } = require('../engine/db');
const { launchWallet } = require('../engine/wallet');
const { build, isWallet } = require('../engine/pay');
exports.handler = wrap(async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  const b = parse(event), sol = Math.round(+b.sol * 1e4) / 1e4;
  if (!isWallet(b.wallet)) return bad('Connect your wallet');
  if (!(sol >= 0.01) || sol > 100) return bad('Top up between 0.01 and 100 SOL');
  const lw = await launchWallet(false); if (!lw) return bad('Not set up yet', 503);
  return json(200, { sol, to: lw.pub, payMessage: await build(b.wallet, [{ to: lw.pub, sol }]) });
});
