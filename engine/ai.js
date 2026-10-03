// The AI parts of Strains, all through OpenRouter (any model, set by environment variable):
//   concept() → a strain thinks up its next coin      judge() → the hourly judge scores new launches
//   offspring() → names a newborn and blends its parents' personalities      image() → coin art from the creature
const KEY = () => process.env.OPENROUTER_API_KEY;
const MODEL = () => process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const IMAGE_MODEL = () => process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-2.5-flash-image';
const { getState, setState } = require('./db');

const RULES = `Hard rules:
- Never use the name, likeness or brand of a real person, company, celebrity, politician or existing crypto project.
- Never promise or hint at profits, price targets, "moon", "100x", returns or investment advice.
- No hate, harassment, sexual content, drugs, violence, tragedies or anything involving minors.
- Output ONLY valid JSON. No markdown.`;

async function call(body, timeoutMs) {
  if (!KEY()) throw new Error('Missing env var OPENROUTER_API_KEY');
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + KEY(), 'Content-Type': 'application/json', 'HTTP-Referer': process.env.SITE_URL || 'https://usestrains.fun', 'X-Title': 'Strains' },
      body: JSON.stringify(body),
    });
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'AI took too long' : 'AI request failed: ' + e.message); }
  finally { clearTimeout(tm); }
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = null; }
  if (!r.ok) throw new Error('OpenRouter ' + r.status + ': ' + ((j && j.error && j.error.message) || t.slice(0, 200)));
  track(j && j.usage);
  return j;
}
// running total of what the AI has cost, for the admin status page
async function track(u) {
  if (!u) return;
  try { const s = await getState('ai_usage', { calls: 0, cost_usd: 0 }); s.calls++; s.cost_usd += +(u.cost || 0) || ((u.prompt_tokens || 0) * 0.3 + (u.completion_tokens || 0) * 2.5) / 1e6; await setState('ai_usage', s); } catch {}
}
async function ask(system, user, { maxTokens = 900, timeoutMs = 12000, temperature = 1 } = {}) {
  const j = await call({ model: MODEL(), max_tokens: maxTokens, temperature, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, timeoutMs);
  const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  const m = String(content || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('AI did not return JSON');
  return JSON.parse(m[0]);
}
const str = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// A strain invents its next coin, in its own personality, without repeating itself.
async function concept(strain, recent = []) {
  const sys = `You are ${strain.name}, a creature in Strains: a lab where AI creatures launch memecoins on pump.fun and only the fittest survive. Every hour the worst creature dies and the best two breed. You survive by launching coins people actually want to trade.
Your personality: ${strain.persona || 'chaotic, funny and a bit strange'}.
Themes you love: ${(strain.vibes || []).join(', ') || 'anything funny'}.
Invent ONE new memecoin. Make it original, punchy and memeable: a character, an in-joke, an absurd idea or a fresh angle. Not a generic "Doge 2.0".
${RULES}
Shape: {"ok":true,"name":"max 28 chars","ticker":"2-8 letters, no $","description":"one or two fun sentences, max 200 chars, in your voice","image":"what the coin's logo shows, max 160 chars, a single mascot or object"}`;
  const user = `Coins you already launched (do not repeat these): ${recent.length ? recent.map((c) => `${c.name} ($${c.ticker})`).join('; ') : 'none yet'}.\nNow invent the next one.`;
  const d = await ask(sys, user, { maxTokens: 400 });
  if (d.ok === false) throw new Error('AI refused: ' + str(d.reason, 120));
  const name = str(d.name, 32).replace(/[^\p{L}\p{N} .,'!?&-]/gu, '').trim();
  const ticker = str(d.ticker, 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (name.length < 2 || ticker.length < 2) throw new Error('AI gave a bad name or ticker');
  return { name, ticker, description: str(d.description, 220), image: str(d.image, 180) };
}

// The judge: scores a batch of new launches 0-10. Separate from the creatures, so nobody grades itself.
async function judge(coins) {
  if (!coins.length) return [];
  const sys = `You are the Judge of Strains, a lab where AI creatures launch memecoins and the weakest die every hour. Score each new coin from 0 to 10 on how well it would do on pump.fun: originality, how memeable and shareable it is, name and ticker quality, and whether it fits what people are joking about online. Be harsh and fair: 5 is average, 8+ is rare, copies and generic ideas score low. For each, write a short punchy verdict (max 90 chars) in a dry lab-report voice.
${RULES}
Shape: {"scores":[{"id":"...","score":0-10,"note":"..."}]}`;
  const user = coins.map((c) => `id: ${c.id}\ncreature: ${c.strain}\ncoin: ${c.name} ($${c.ticker})\nabout: ${c.description}`).join('\n\n');
  const d = await ask(sys, user, { maxTokens: 120 + coins.length * 70, temperature: 0.4, timeoutMs: 15000 });
  return (Array.isArray(d.scores) ? d.scores : []).map((s) => ({ id: String(s.id), score: Math.max(0, Math.min(10, Math.round(+s.score * 10) / 10 || 0)), note: str(s.note, 100) }));
}

// A newborn: name it and blend its parents' personalities.
async function offspring(a, b) {
  const sys = `Two creatures in Strains just bred. Name their child and describe its personality as a blend of both parents, with one new quirk of its own. The name is one or two words (max 18 chars), often a fun mix of the parents' names.
${RULES}
Shape: {"name":"...","persona":"two short sentences, max 200 chars"}`;
  const user = `Parent A: ${a.name}. Personality: ${a.persona || 'unknown'}. Themes: ${(a.vibes || []).join(', ')}.\nParent B: ${b.name}. Personality: ${b.persona || 'unknown'}. Themes: ${(b.vibes || []).join(', ')}.`;
  const d = await ask(sys, user, { maxTokens: 200 });
  const name = str(d.name, 18).replace(/[^\p{L}\p{N} '-]/gu, '').trim();
  if (name.length < 2) throw new Error('bad name');
  // keep it short, and never cut a sentence in half
  let persona = str(d.persona, 600);
  if (persona.length > 240) { const cut = persona.slice(0, 240); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); persona = end > 60 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…'; }
  return { name, persona };
}

// Coin art: the creature, redrawn as the coin's mascot. Returns { buffer, type } or null.
async function image(avatarPng, coin) {
  const prompt = `This creature is the parent of a new memecoin called "${coin.name}" ($${coin.ticker}). Make a square coin logo: the same creature (same body shape, colours, eyes, mouth and features, thick black outlines, cute cartoon style) shown as ${coin.image || 'the coin mascot'}. Bold and simple, centred, plain colourful background. No text, no letters, no logos.`;
  const j = await call({ model: IMAGE_MODEL(), modalities: ['image', 'text'], messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + avatarPng.toString('base64') } }] }] }, 18000);
  const msg = j && j.choices && j.choices[0] && j.choices[0].message;
  const url = msg && msg.images && msg.images[0] && msg.images[0].image_url && msg.images[0].image_url.url;
  const m = String(url || '').match(/^data:(image\/[a-z]+);base64,(.+)$/); if (!m) return null;
  return { buffer: Buffer.from(m[2], 'base64'), type: m[1] };
}

module.exports = { concept, judge, offspring, image };
