// The lab: living strains by score (or newest / the dead), with a few of their latest coins.
const { wrap, json, sb } = require('../engine/db');
const PUB = 'id,slug,name,status,genome,avatar_url,generation,parent_a,parent_b,children,born_at,died_at,death_note,launches,fitness,form,judge_avg,rank,fees_sol,interval_min,paused,owners,next_launch_at,error';
exports.handler = wrap(async (event) => {
  const q = event.queryStringParameters || {};
  const sort = q.sort || 'rank', limit = Math.min(200, +q.limit || 100);
  let path = `st_strains?select=${PUB}&limit=${limit}`;
  if (sort === 'dead') path += '&status=eq.dead&order=died_at.desc';
  else if (sort === 'new') path += '&status=eq.alive&order=born_at.desc';
  else if (sort === 'gen') path += '&status=eq.alive&order=generation.desc,form.desc';
  else path += '&status=eq.alive&order=rank.asc.nullslast,born_at.asc';
  const strains = await sb(path);
  const ids = strains.map((s) => s.id);
  const coins = ids.length ? await sb(`st_coins?strain_id=in.(${ids.join(',')})&status=eq.live&order=launched_at.desc&limit=600&select=strain_id,name,ticker,mint,image_url,mcap,judge_score`) : [];
  for (const s of strains) { s.coins = coins.filter((c) => c.strain_id === s.id).slice(0, 4); s.co_owned = (s.owners || []).length > 1; s.owners = (s.owners || []).map((o) => ({ wallet: o.wallet, share: o.share })); }
  return json(200, { strains });
});
