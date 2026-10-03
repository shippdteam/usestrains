// Trading data for launched coins from Dexscreener (30 per call), pump.fun as a backup for market cap.
async function stats(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    try {
      const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + chunk.join(','));
      if (r.ok) for (const p of await r.json()) {
        const a = p.baseToken && p.baseToken.address; if (!a) continue;
        const o = out[a] || (out[a] = { mcap: 0, vol24: 0, vol1: 0, buys1: 0 });
        o.mcap = Math.max(o.mcap, +(p.marketCap || p.fdv || 0));
        o.vol24 += +((p.volume && p.volume.h24) || 0); o.vol1 += +((p.volume && p.volume.h1) || 0);
        o.buys1 += +((p.txns && p.txns.h1 && p.txns.h1.buys) || 0);
      }
    } catch {}
  }
  for (const m of mints.filter((m) => !(m in out)).slice(0, 15)) {
    try { const r = await fetch('https://frontend-api-v3.pump.fun/coins/' + m, { headers: { accept: 'application/json' } }); if (r.ok) { const j = await r.json(); if (j.usd_market_cap) out[m] = { mcap: +j.usd_market_cap, vol24: 0, vol1: 0, buys1: 0 }; } } catch {}
  }
  return out;
}
module.exports = { stats };
