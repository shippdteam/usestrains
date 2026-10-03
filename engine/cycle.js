// The hourly cycle, on the hour:
//   1. read trading for every recent coin   2. the AI judge scores new launches
//   3. every living strain gets a score     4. the worst dies     5. the best two breed
const { sb, now, getState, setState } = require('./db');
const { cfg } = require('./cfg');
const AI = require('./ai');
const C = require('../web/assets/creature.js');
const { stats } = require('./market');
const { storeAvatar } = require('./art');
const { ev } = require('./launcher');

// many rows in one request: insert-or-update by id
const upsert = (table, rows) => rows.length ? sb(table + '?on_conflict=id', { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }) : null;
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'strain';
async function uniqueSlug(name) {
  const base = slugify(name); let slug = base;
  const taken = new Set((await sb(`st_strains?slug=like.${base}*&status=neq.failed&select=slug`)).map((r) => r.slug));
  for (let n = 2; taken.has(slug) || ['create', 'lab', 'me', 'admin'].includes(slug); n++) slug = base + '-' + n;
  return slug;
}

async function market(log) {
  const coins = await sb(`st_coins?status=eq.live&or=(launched_at.gt.${hoursAgo(72)},vol_h24.gt.0)&select=id,mint,mcap,ath_mcap&order=launched_at.desc&limit=600`);
  const st = await stats(coins.map((c) => c.mint).filter(Boolean));
  const rows = coins.map((c) => { const m = st[c.mint] || { mcap: 0, vol24: 0, vol1: 0, buys1: 0 }; return { id: c.id, vol_h1: m.vol1, vol_h24: m.vol24, buys_h1: m.buys1, mcap: m.mcap || +c.mcap || 0, ath_mcap: Math.max(m.mcap || 0, +c.ath_mcap || 0) }; });
  for (let i = 0; i < rows.length; i += 200) await upsert('st_coins', rows.slice(i, i + 200));
  log.push(`market: ${rows.length} coins`);
}

async function judge(log) {
  // fast strains launch a lot, so judge in batches (newest first, up to 80 an hour)
  let n = 0;
  for (let round = 0; round < 2; round++) {
    const coins = await sb(`st_coins?status=eq.live&judged_at=is.null&order=launched_at.desc&limit=40&select=id,name,ticker,description,strain_id`);
    if (!coins.length) break;
    const names = {}; for (const s of await sb(`st_strains?id=in.(${[...new Set(coins.map((c) => c.strain_id))].join(',')})&select=id,name`)) names[s.id] = s.name;
    let scores = [];
    try { scores = await AI.judge(coins.map((c) => ({ ...c, strain: names[c.strain_id] || '?' }))); } catch (e) { log.push('judge failed: ' + e.message.slice(0, 80)); break; }
    for (const s of scores) {
      const c = coins.find((x) => x.id === s.id); if (!c) continue;
      await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { judge_score: s.score, judge_note: s.note, judged_at: now() }, headers: { Prefer: 'return=minimal' } });
      await ev('verdict', { id: c.strain_id }, c, `Judge on $${c.ticker}: ${s.score}/10. ${s.note}`, { score: s.score, ticker: c.ticker });
      n++;
    }
    // anything the judge skipped is marked so it never blocks the queue
    const missed = coins.filter((c) => !scores.some((s) => s.id === c.id)).map((c) => c.id);
    if (missed.length) await sb(`st_coins?id=in.(${missed.join(',')})`, { method: 'PATCH', body: { judged_at: now() }, headers: { Prefer: 'return=minimal' } });
  }
  if (n) log.push(`judged ${n}`);
}

// score = trading this hour (ranked against every other strain) + the judge's average on its last 3 coins
async function score(log) {
  const K = cfg();
  const alive = await sb('st_strains?status=eq.alive&select=*');
  const recentCoins = await sb(`st_coins?status=eq.live&launched_at=gt.${hoursAgo(24)}&select=strain_id,vol_h1,buys_h1&limit=5000`);
  const raw = {};
  for (const c of recentCoins) { const r = raw[c.strain_id] || (raw[c.strain_id] = { vol: 0, buys: 0 }); r.vol += +c.vol_h1 || 0; r.buys += +c.buys_h1 || 0; }
  const mkt = (s) => { const r = raw[s.id]; return r ? Math.log10(1 + r.vol) + 0.5 * Math.log10(1 + r.buys) : 0; };
  const vals = alive.map(mkt), positive = vals.filter((v) => v > 0).sort((a, b) => a - b);
  // the judge's last 3 scores per strain
  const judged = {};
  for (const c of await sb(`st_coins?judge_score=not.is.null&launched_at=gt.${hoursAgo(72)}&order=launched_at.desc&select=strain_id,judge_score&limit=5000`)) { const l = judged[c.strain_id] || (judged[c.strain_id] = []); if (l.length < 3) l.push(+c.judge_score); }
  for (const s of alive) {
    const m = mkt(s), pct = m > 0 ? (positive.filter((v) => v <= m).length / positive.length) : 0;
    const js = judged[s.id] || [], j = js.length ? js.reduce((a, b) => a + b, 0) / js.length / 10 : 0;
    s.fitness = Math.round((K.marketWeight * pct + (100 - K.marketWeight) * j) * 10) / 10;
    s.form = s.form == null ? s.fitness : Math.round((0.5 * +s.form + 0.5 * s.fitness) * 10) / 10;
    s.judge_avg = js.length ? Math.round(j * 100) / 10 : null; s.market_h1 = Math.round((raw[s.id] ? raw[s.id].vol : 0) * 100) / 100;
  }
  alive.sort((a, b) => b.form - a.form || new Date(a.born_at) - new Date(b.born_at));
  alive.forEach((s, i) => (s.rank = i + 1));
  await upsert('st_strains', alive.map((s) => ({ id: s.id, fitness: s.fitness, form: s.form, judge_avg: s.judge_avg, market_h1: s.market_h1, rank: s.rank })));
  log.push(`scored ${alive.length}`);
  return alive;
}

async function cull(alive, log) {
  const K = cfg(), out = [];
  let living = alive.length;
  const eligible = alive.filter((s) => new Date(s.born_at) < new Date(hoursAgo(K.graceHours))).sort((a, b) => a.form - b.form || +a.fees_sol - +b.fees_sol || new Date(a.born_at) - new Date(b.born_at));
  for (const s of eligible) {
    if (out.length >= K.cullPerHour || living <= K.minPopulation) break;
    const note = `Ranked ${s.rank} of ${alive.length} with a score of ${s.form}. ${s.launches || 0} coin${s.launches === 1 ? '' : 's'} launched.`;
    const got = await sb(`st_strains?id=eq.${s.id}&status=eq.alive`, { method: 'PATCH', body: { status: 'dead', died_at: now(), death_note: note } });
    if (!got.length) continue;
    await ev('death', s, null, `${s.name} died. ${note}`, { rank: s.rank, form: s.form });
    out.push(s.name); living--;
  }
  if (out.length) log.push('died: ' + out.join(', '));
  return alive.filter((s) => !out.includes(s.name));
}

// owners of a child: half from each parent, merged (a grandchild splits further)
function mergeOwners(a, b) {
  const m = {};
  for (const o of a || []) m[o.wallet] = (m[o.wallet] || 0) + o.share / 2;
  for (const o of b || []) m[o.wallet] = (m[o.wallet] || 0) + o.share / 2;
  return Object.entries(m).map(([wallet, share]) => ({ wallet, share: Math.round(share * 1e6) / 1e6 }));
}
const near = (list, v) => list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);

async function breed(alive, log) {
  const K = cfg(); if (alive.length < 2 || alive.length >= K.maxPopulation) return;
  const ranked = alive.filter((s) => +s.form > 0).sort((a, b) => b.form - a.form);
  let made = 0;
  for (let i = 0; i < ranked.length && made < K.breedPerHour; i++) for (let j = i + 1; j < ranked.length && made < K.breedPerHour; j++) {
    const a = ranked[i], b = ranked[j];
    if ((a.bred_with || []).includes(b.id) || a.id === b.parent_a || a.id === b.parent_b || b.id === a.parent_a || b.id === a.parent_b) continue;
    const kid = C.breed(a.genome, b.genome, a.id + b.id);
    let name, persona;
    try { ({ name, persona } = await AI.offspring(a, b)); } catch { name = (a.name.slice(0, Math.ceil(a.name.length / 2)) + b.name.slice(Math.floor(b.name.length / 2))).slice(0, 18); persona = `Half ${a.name}, half ${b.name}.`; }
    const vibes = [...new Set([...(a.vibes || []).slice(0, 2), ...(b.vibes || []).slice(0, 2)])].slice(0, 4);
    const row = { status: 'alive', slug: await uniqueSlug(name), name, persona, vibes, genome: kid.genome, owners: mergeOwners(a.owners, b.owners),
      creator_wallet: null, interval_min: Math.max(K.minInterval, Math.round(((a.interval_min || 240) + (b.interval_min || 240)) / 2)), dev_buy_sol: 0,
      generation: Math.max(a.generation || 0, b.generation || 0) + 1, parent_a: a.id, parent_b: b.id, born_at: now(), next_launch_at: new Date(Date.now() + 5 * 60e3).toISOString() };
    const [child] = await sb('st_strains', { method: 'POST', body: row });
    try { await sb(`st_strains?id=eq.${child.id}`, { method: 'PATCH', body: { avatar_url: await storeAvatar(child) } }); } catch (e) { console.error('avatar', e.message); }
    await sb(`st_strains?id=eq.${a.id}`, { method: 'PATCH', body: { bred_with: [...(a.bred_with || []), b.id], children: (a.children || 0) + 1 } });
    await sb(`st_strains?id=eq.${b.id}`, { method: 'PATCH', body: { bred_with: [...(b.bred_with || []), a.id], children: (b.children || 0) + 1 } });
    await ev('birth', child, null, `${a.name} × ${b.name} → ${name} was born (gen ${row.generation})`, { parents: [a.slug, b.slug], mutated: kid.mutated, from: kid.from });
    made++; log.push(`born: ${name} (${a.name} × ${b.name})`);
  }
}

async function cycle() {
  const log = [], t0 = Date.now();
  await market(log);
  await judge(log);
  let alive = await score(log);
  alive = await cull(alive, log);
  await breed(alive, log);
  const n = (await sb('st_strains?status=eq.alive&select=id')).length;
  await setState('last_cycle', { at: now(), log, alive: n, ms: Date.now() - t0 });
  return log;
}
module.exports = { cycle, mergeOwners, uniqueSlug, slugify };
