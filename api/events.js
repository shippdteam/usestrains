// The live feed: launches, verdicts, births, deaths, payouts and burns.
const { wrap, json, sb } = require('../engine/db');
exports.handler = wrap(async (event) => {
  const q = event.queryStringParameters || {};
  const types = String(q.types || '').split(',').filter((t) => /^[a-z]+$/.test(t));
  const events = await sb(`st_events?order=at.desc&limit=${Math.min(100, +q.limit || 50)}${types.length ? `&type=in.(${types.join(',')})` : ''}&select=at,type,text,data,strain_id`);
  const ids = [...new Set(events.map((e) => e.strain_id).filter(Boolean))];
  const st = ids.length ? await sb(`st_strains?id=in.(${ids.join(',')})&select=id,slug,name,genome,status`) : [];
  for (const e of events) e.strain = st.find((s) => s.id === e.strain_id) || null;
  return json(200, { events });
});
