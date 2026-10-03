// One strain: its creature, family, coins and history.
const { wrap, json, bad, sb } = require('../engine/db');
exports.handler = wrap(async (event) => {
  const slug = String((event.queryStringParameters || {}).slug || '').toLowerCase();
  const s = (await sb(`st_strains?slug=eq.${encodeURIComponent(slug)}&status=in.(alive,dead)&select=*`))[0];
  if (!s) return bad('No strain by that name', 404);
  delete s.pay_sig; delete s.launch_lock_until;
  const fam = [s.parent_a, s.parent_b].filter(Boolean);
  const [parents, children, coins, events, alive] = await Promise.all([
    fam.length ? sb(`st_strains?id=in.(${fam.join(',')})&select=id,slug,name,genome,status,generation`) : [],
    sb(`st_strains?or=(parent_a.eq.${s.id},parent_b.eq.${s.id})&status=in.(alive,dead)&select=id,slug,name,genome,status,generation,born_at&order=born_at.desc`),
    sb(`st_coins?strain_id=eq.${s.id}&status=in.(live,new,concept,imaged)&order=created_at.desc&limit=60&select=id,status,name,ticker,description,image_url,mint,launched_at,mcap,ath_mcap,vol_h24,judge_score,judge_note,fees_sol`),
    sb(`st_events?strain_id=eq.${s.id}&order=at.desc&limit=40&select=at,type,text,data`),
    sb('st_strains?status=eq.alive&select=id'),
  ]);
  return json(200, { strain: s, parents, children, coins, events, alive: alive.length });
});
