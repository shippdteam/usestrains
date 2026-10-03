// Every minute: strains whose launch time has come pay for a coin from their owners' fuel, think it up,
// get its art, and launch it on pump.fun from the launch wallet. Each coin moves through steps
// (new → concept → imaged → live) so no single run has to do everything inside one scheduled run's time limit.
const { sb, fn, now, SITE, rpc } = require('./db');
const { cfg } = require('./cfg');
const AI = require('./ai');
const { uploadImage } = require('./images');
const { uploadMetadata, createCoin, newKeypair } = require('./solana');
const { launchWallet, apiKey } = require('./wallet');

const ev = (type, strain, coin, text, data) => sb('st_events', { method: 'POST', body: { type, strain_id: strain && strain.id, coin_id: coin && coin.id, text, data: data || null }, headers: { Prefer: 'return=minimal' } });
const inMin = (m) => new Date(Date.now() + m * 60e3).toISOString();

async function lockCoin(c, secs = 40) {
  const got = await sb(`st_coins?id=eq.${c.id}&or=(lock_until.is.null,lock_until.lt.${now()})`, { method: 'PATCH', body: { lock_until: new Date(Date.now() + secs * 1e3).toISOString() } });
  return got && got.length ? got[0] : null;
}
async function refund(c) {
  const ch = c.charged; if (!ch || !ch.owners || ch.refunded) return;
  for (const o of ch.owners) await fn('st_add_fuel', { p_wallet: o.wallet, p_sol: +(o.share * ch.sol).toFixed(9), p_deposit: false });
  await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { charged: { ...ch, refunded: true } } });
}
async function fail(c, strain, msg) {
  await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { status: 'failed', error: String(msg).slice(0, 300), lock_until: null } });
  await refund(c);
  return 'failed: ' + String(msg).slice(0, 80);
}
async function retryOrFail(c, strain, e, max = 3) {
  const attempts = (+c.attempts || 0) + 1;
  if (attempts >= max) return fail(c, strain, e.message || e);
  // try again in a couple of minutes, not straight away
  await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { attempts, error: String(e.message || e).slice(0, 300), lock_until: new Date(Date.now() + 120e3).toISOString() } });
  return 'retry: ' + String(e.message || e).slice(0, 80);
}

// 1) strains that are due: charge fuel and queue a coin
async function startDue(left) {
  const C = cfg(), log = [];
  const due = await sb(`st_strains?status=eq.alive&paused=is.false&next_launch_at=lt.${now()}&order=next_launch_at.asc&limit=10&select=*`);
  for (const s of due) {
    if (left() < 5000) break;
    const busy = await sb(`st_coins?strain_id=eq.${s.id}&status=in.(new,concept,imaged)&select=id`); if (busy.length) continue;
    const owners = s.owners || [], single = owners.length === 1;
    const devBuy = single ? +s.dev_buy_sol || 0 : 0, sol = +(C.launchCost + devBuy).toFixed(9);
    // push the next launch time first so a slow run can never double-launch
    const moved = await sb(`st_strains?id=eq.${s.id}&next_launch_at=lt.${now()}`, { method: 'PATCH', body: { next_launch_at: inMin(s.interval_min || 240) } });
    if (!moved.length) continue;
    const ok = await fn('st_charge', { p_owners: owners, p_sol: sol });
    if (!ok) {
      await sb(`st_strains?id=eq.${s.id}`, { method: 'PATCH', body: { next_launch_at: inMin(15), error: 'Out of fuel. Top it up to keep launching.' } });
      log.push(s.name + ': out of fuel'); continue;
    }
    await sb('st_coins', { method: 'POST', body: { strain_id: s.id, status: 'new', dev_buy_sol: devBuy, charged: { owners, sol }, tokens_to: devBuy > 0 ? owners[0].wallet : null } });
    if (s.error) await sb(`st_strains?id=eq.${s.id}`, { method: 'PATCH', body: { error: null } });
    log.push(s.name + ': queued');
  }
  return log;
}

// 2) move queued coins forward: ideas and art run in parallel, launches one after another
async function strainOf(c) { return (await sb(`st_strains?id=eq.${c.strain_id}&select=*`))[0]; }
async function stepConcept(c) {
  const s = await strainOf(c); if (!s) return fail(c, null, 'strain missing');
  try {
    const recent = await sb(`st_coins?strain_id=eq.${s.id}&status=eq.live&order=created_at.desc&limit=12&select=name,ticker`);
    const k = await AI.concept(s, recent);
    await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { status: 'concept', name: k.name, ticker: k.ticker, description: k.description, image_idea: k.image, attempts: 0, error: null } });
    return 'idea ' + k.ticker;
  } catch (e) { return retryOrFail(c, s, e, 4); }
}
async function stepImage(c) {
  const s = await strainOf(c); if (!s) return fail(c, null, 'strain missing');
  let url = null;
  if (cfg().aiImages && process.env.OPENROUTER_API_KEY && s.avatar_url) {
    try {
      const av = Buffer.from(await (await fetch(s.avatar_url)).arrayBuffer());
      const img = await AI.image(av, { name: c.name, ticker: c.ticker, image: c.image_idea });
      if (img && img.buffer.length > 2000) url = await uploadImage('coins/' + c.id, img.buffer, img.type);
    } catch (e) { console.error('coin art', e.message); }
  }
  await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { status: 'imaged', image_url: url || s.avatar_url } });
  return url ? 'art ' + c.ticker : 'art (creature) ' + c.ticker;
}
async function stepCreate(c) {
  const s = await strainOf(c); if (!s) return fail(c, null, 'strain missing');
  const C = cfg(), w = await launchWallet(false); if (!w) return 'no launch wallet';
  // a run that was cut off mid-launch: if the coin exists on-chain, it launched; never launch it twice
  if (c.mint) {
    const info = await rpc('getAccountInfo', [c.mint, { encoding: 'base64', commitment: 'confirmed' }]).catch(() => null);
    if (info && info.value) return goLive(c, s, c.mint, null, ' (recovered)');
  }
  try {
    const imgRes = await fetch(c.image_url); if (!imgRes.ok) throw new Error('image fetch ' + imgRes.status);
    const buf = Buffer.from(await imgRes.arrayBuffer()), type = imgRes.headers.get('content-type') || 'image/png';
    const page = `${SITE()}/s/${s.slug}`;
    const desc = `${c.description} | Launched by ${s.name}, a Strains creature (gen ${s.generation}). ${page}`.slice(0, 480);
    const uri = await uploadMetadata({ imageBuffer: buf, imageType: type, name: c.name, symbol: c.ticker, description: desc, website: page, twitter: C.xUrl || undefined });
    const mint = newKeypair();
    await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { mint: mint.publicKey } });
    const r = await createCoin({ apiKey: apiKey(w), name: c.name, symbol: c.ticker, metadataUri: uri, devBuySol: +c.dev_buy_sol || 0, priorityFee: C.priorityFee, mint });
    return goLive(c, s, mint.publicKey, r.signature, '');
  } catch (e) {
    // PumpPortal sends nothing when it returns an error, so the coin never reached the chain: retry, then refund
    await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { mint: null } });
    return retryOrFail({ ...c, mint: null }, s, e, 3);
  }
}
async function goLive(c, s, mint, sig, note) {
  await sb(`st_coins?id=eq.${c.id}`, { method: 'PATCH', body: { status: 'live', mint, create_sig: sig, launched_at: now(), lock_until: null, error: null } });
  const fresh = (await sb(`st_strains?id=eq.${s.id}&select=launches`))[0] || s;
  await sb(`st_strains?id=eq.${s.id}`, { method: 'PATCH', body: { launches: (+fresh.launches || 0) + 1, last_launch_at: now() } });
  await ev('launch', s, c, `${s.name} launched ${c.name} ($${c.ticker})`, { mint, ticker: c.ticker, image: c.image_url });
  return 'live ' + c.ticker + note;
}

// lock a batch of coins in one status and run a step on all of them at once
async function batch(status, limit, secs, step) {
  const rows = await sb(`st_coins?status=eq.${status}&or=(lock_until.is.null,lock_until.lt.${now()})&order=created_at.asc&limit=${limit}&select=*`);
  const mine = (await Promise.all(rows.map((c) => lockCoin(c, secs)))).filter(Boolean);
  return Promise.all(mine.map(async (c) => {
    let res;
    try { res = await step(c); return (c.name || c.id.slice(0, 6)) + ': ' + res; }
    catch (e) { return 'err ' + String(e.message).slice(0, 80); }
    finally { if (!/^retry/.test(res || '')) await sb(`st_coins?id=eq.${c.id}&status=neq.failed`, { method: 'PATCH', body: { lock_until: null } }); }
  }));
}

// each scheduled run gets 30 seconds, so the budget is 26
async function tick(budgetMs = 26000) {
  const t0 = Date.now(), left = () => budgetMs - (Date.now() - t0), log = [];
  log.push(...(await startDue(left)));
  if (left() > 14000) log.push(...(await batch('new', 6, 20, stepConcept)));
  if (left() > 20000) log.push(...(await batch('concept', 4, 26, stepImage)));
  else if (!(cfg().aiImages && process.env.OPENROUTER_API_KEY)) log.push(...(await batch('concept', 6, 10, stepImage)));
  while (left() > 6000) {
    const r = await batch('imaged', 1, 15, stepCreate); if (!r.length) break; log.push(...r);
  }
  // dev-buy tokens on their way to owners
  if (left() > 5000) for (const c of await sb('st_coins?status=eq.live&tokens_sent=is.false&tokens_to=not.is.null&limit=4&select=*')) {
    if (left() < 3000) break;
    try { log.push('tokens ' + c.ticker + ': ' + (await require('./deliver').deliver(c))); } catch (e) { log.push('tokens err ' + e.message.slice(0, 60)); }
  }
  return log;
}
module.exports = { tick, ev };
