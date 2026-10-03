// Strains creatures: a genome (a few numbers) → an SVG. Used by the builder, every page, and the server
// (which renders each strain's PNG and breeds children). Works in the browser (window.Creature) and in Node.
(function (root) {
  const INK = '#101511';
  const GENES = {
    body: ['Blob', 'Bean', 'Pear', 'Cube', 'Star', 'Ghost', 'Drop'],
    eyes: ['Pair', 'Cyclops', 'Triple', 'Sleepy', 'Angry', 'Spiral', 'Visor', 'Wide'],
    mouth: ['Smile', 'Fangs', 'Ooh', 'Zigzag', 'Tongue', 'Flat', 'Grin'],
    top: ['None', 'Antennae', 'Horns', 'Ears', 'Spikes', 'Sprout', 'Crown', 'Mohawk'],
    pattern: ['Plain', 'Spots', 'Stripes', 'Belly', 'Freckles'],
    limbs: ['None', 'Nubs', 'Tentacles', 'Wings', 'Arms'],
  };
  const HUES = [8, 24, 42, 58, 88, 128, 162, 188, 206, 232, 262, 292, 318, 340];
  const clampG = (g) => {
    const o = {};
    for (const k of Object.keys(GENES)) o[k] = Math.max(0, Math.min(GENES[k].length - 1, Math.round(+(g && g[k]) || 0)));
    o.hue = ((Math.round(+(g && g.hue)) || 0) % 360 + 360) % 360;
    o.hue2 = ((Math.round(+(g && g.hue2)) || 0) % 360 + 360) % 360;
    o.size = Math.max(0, Math.min(2, Math.round(+(g && g.size) || 1)));
    return o;
  };
  const rng = (seed) => { let s = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0; s = (s ^ (s >>> 13)) >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const hashStr = (str) => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  // smooth closed path through points (Catmull-Rom → cubic Bézier)
  function smooth(pts) {
    const n = pts.length; let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d + 'Z';
  }
  // radius of each body at angle a (screen coords: a = -π/2 is the top)
  const R = {
    0: (a) => 60 + 5 * Math.sin(3 * a + 0.6) + 3 * Math.cos(5 * a),
    1: (a) => { const A = 52, B = 64; return (A * B) / Math.sqrt((B * Math.cos(a)) ** 2 + (A * Math.sin(a)) ** 2); },
    2: (a) => { const A = 52, B = 60; return ((A * B) / Math.sqrt((B * Math.cos(a)) ** 2 + (A * Math.sin(a)) ** 2)) * (1 + 0.16 * Math.sin(a)); },
    3: (a) => 60 / Math.pow(Math.pow(Math.abs(Math.cos(a)), 5) + Math.pow(Math.abs(Math.sin(a)), 5), 1 / 5),
    4: (a) => 57 + 11 * Math.cos(5 * (a + Math.PI / 2)),
    5: (a) => 60,
    6: (a) => 58 * (1 + 0.32 * Math.max(0, -Math.sin(a)) ** 3) - 4 * Math.sin(a),
  };
  function bodyPath(b, cx, cy, k) {
    if (b === 5) { // ghost: dome + wavy hem
      const w = 58 * k, top = cy - 62 * k, hem = cy + 52 * k;
      let d = `M${cx - w} ${hem}L${cx - w} ${cy - 6 * k}C${cx - w} ${top - 4 * k} ${cx + w} ${top - 4 * k} ${cx + w} ${cy - 6 * k}L${cx + w} ${hem}`;
      const waves = 4, step = (2 * w) / waves;
      for (let i = 0; i < waves; i++) { const x1 = cx + w - step * i, x2 = x1 - step; d += `Q${x1 - step / 4} ${hem + 14 * k} ${x1 - step / 2} ${hem}Q${x2 + step / 4} ${hem - 10 * k} ${x2} ${hem}`; }
      return { d: d + 'Z', top, bottom: hem + 8 * k, w };
    }
    const f = R[b] || R[0], pts = [];
    for (let i = 0; i < 56; i++) { const a = (i / 56) * Math.PI * 2 - Math.PI / 2; const r = f(a) * k; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return { d: smooth(pts), top: cy - f(-Math.PI / 2) * k, bottom: cy + f(Math.PI / 2) * k, w: f(0) * k };
  }
  const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;

  // opts: { bg: true|false|'#hex', id: unique string for gradient ids, dead: bool }
  function svg(gIn, opts = {}) {
    const g = clampG(gIn), id = (opts.id || 'c' + Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/gi, '');
    const k = [0.6, 0.78, 0.94][g.size], cx = 100, cy = 106;
    const dead = !!opts.dead, sat = dead ? 0 : 72, sat2 = dead ? 0 : 78;
    const c1 = hsl(g.hue, sat, 62), c1d = hsl(g.hue, sat, 48), c1l = hsl(g.hue, sat, 76), c2 = hsl(g.hue2, sat2, 58), c2l = hsl(g.hue2, sat2, 80);
    const B = bodyPath(g.body, cx, cy, k), sw = 4.5;
    const S = (w) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`, st = S(sw);
    let back = '', front = '', top = '', pat = '', face = '';
    // limbs behind the body
    if (g.limbs === 2) for (let i = 0; i < 4; i++) { const x = cx - 36 * k + i * 24 * k, y = B.bottom - 10 * k; back += `<path d="M${x} ${y}q${(i % 2 ? 9 : -9) * k} ${18 * k} 0 ${30 * k}q${(i % 2 ? -8 : 8) * k} ${8 * k} ${(i % 2 ? 2 : -2) * k} ${14 * k}" fill="none" ${S(sw + 7)}/><path d="M${x} ${y}q${(i % 2 ? 9 : -9) * k} ${18 * k} 0 ${30 * k}q${(i % 2 ? -8 : 8) * k} ${8 * k} ${(i % 2 ? 2 : -2) * k} ${14 * k}" fill="none" stroke="${c1d}" stroke-width="7" stroke-linecap="round"/>`; }
    if (g.limbs === 3) for (const s of [-1, 1]) back += `<path d="M${cx + s * B.w * 0.55} ${cy - 8 * k}C${cx + s * (B.w + 38 * k)} ${cy - 62 * k} ${cx + s * (B.w + 46 * k)} ${cy + 4 * k} ${cx + s * (B.w + 26 * k)} ${cy + 16 * k}C${cx + s * (B.w + 38 * k)} ${cy + 26 * k} ${cx + s * (B.w + 14 * k)} ${cy + 34 * k} ${cx + s * B.w * 0.6} ${cy + 18 * k}Z" fill="${c2l}" ${st}/><path d="M${cx + s * (B.w + 6 * k)} ${cy - 18 * k}L${cx + s * (B.w + 28 * k)} ${cy + 4 * k}" ${S(3)} fill="none" opacity=".5"/>`;
    if (g.limbs === 1) for (const s of [-1, 1]) back += `<ellipse cx="${cx + s * 26 * k}" cy="${B.bottom - 2 * k}" rx="${15 * k}" ry="${10 * k}" fill="${c1d}" ${st}/>`;
    if (g.limbs === 4) for (const s of [-1, 1]) back += `<path d="M${cx + s * (B.w - 8 * k)} ${cy + 6 * k}q${s * 26 * k} ${-4 * k} ${s * 30 * k} ${-26 * k}" fill="none" ${S(sw + 8)}/><path d="M${cx + s * (B.w - 8 * k)} ${cy + 6 * k}q${s * 26 * k} ${-4 * k} ${s * 30 * k} ${-26 * k}" fill="none" stroke="${c1}" stroke-width="8" stroke-linecap="round"/><circle cx="${cx + s * (B.w + 22 * k)}" cy="${cy - 22 * k}" r="${8 * k}" fill="${c1l}" ${st}/>`;
    // top
    const T = B.top + 6 * k;
    if (g.top === 1) for (const s of [-1, 1]) top += `<path d="M${cx + s * 14 * k} ${T}Q${cx + s * 20 * k} ${T - 34 * k} ${cx + s * 36 * k} ${T - 44 * k}" fill="none" ${st}/><circle cx="${cx + s * 36 * k}" cy="${T - 44 * k}" r="${8 * k}" fill="${c2}" ${st}/>`;
    if (g.top === 2) for (const s of [-1, 1]) top += `<path d="M${cx + s * 18 * k} ${T + 4 * k}C${cx + s * 22 * k} ${T - 22 * k} ${cx + s * 40 * k} ${T - 34 * k} ${cx + s * 46 * k} ${T - 46 * k}C${cx + s * 52 * k} ${T - 24 * k} ${cx + s * 46 * k} ${T - 2 * k} ${cx + s * 34 * k} ${T + 10 * k}Z" fill="#FBF4E2" ${st}/>`;
    if (g.top === 3) for (const s of [-1, 1]) top += `<path d="M${cx + s * 14 * k} ${T + 8 * k}L${cx + s * 32 * k} ${T - 34 * k}L${cx + s * 50 * k} ${T + 14 * k}Z" fill="${c1}" ${st}/><path d="M${cx + s * 25 * k} ${T + 4 * k}L${cx + s * 32 * k} ${T - 18 * k}L${cx + s * 40 * k} ${T + 6 * k}Z" fill="${c2l}"/>`;
    if (g.top === 4) [-1, 0, 1].forEach((s) => { top += `<path d="M${cx + s * 22 * k - 11 * k} ${T + (s ? 6 : 2) * k}L${cx + s * 22 * k} ${T - (s ? 22 : 30) * k}L${cx + s * 22 * k + 11 * k} ${T + (s ? 6 : 2) * k}Z" fill="${c2}" ${st}/>`; });
    if (g.top === 5) top += `<path d="M${cx} ${T + 4 * k}Q${cx - 2 * k} ${T - 18 * k} ${cx + 4 * k} ${T - 30 * k}" fill="none" ${st}/><path d="M${cx + 3 * k} ${T - 24 * k}C${cx - 18 * k} ${T - 40 * k} ${cx - 34 * k} ${T - 22 * k} ${cx - 28 * k} ${T - 14 * k}C${cx - 18 * k} ${T - 8 * k} ${cx - 4 * k} ${T - 14 * k} ${cx + 3 * k} ${T - 24 * k}Z" fill="${dead ? '#9a9a9a' : '#5DC26A'}" ${st}/><path d="M${cx + 4 * k} ${T - 28 * k}C${cx + 16 * k} ${T - 48 * k} ${cx + 36 * k} ${T - 38 * k} ${cx + 32 * k} ${T - 28 * k}C${cx + 26 * k} ${T - 18 * k} ${cx + 12 * k} ${T - 20 * k} ${cx + 4 * k} ${T - 28 * k}Z" fill="${dead ? '#b0b0b0' : '#8BDB6E'}" ${st}/>`;
    if (g.top === 6) top += `<path d="M${cx - 24 * k} ${T + 4 * k}L${cx - 28 * k} ${T - 24 * k}L${cx - 13 * k} ${T - 10 * k}L${cx} ${T - 30 * k}L${cx + 13 * k} ${T - 10 * k}L${cx + 28 * k} ${T - 24 * k}L${cx + 24 * k} ${T + 4 * k}Z" fill="${dead ? '#bbb' : '#FFC93C'}" ${st}/><circle cx="${cx}" cy="${T - 6 * k}" r="${4 * k}" fill="${c2}" stroke="${INK}" stroke-width="2.5"/>`;
    if (g.top === 7) { let d = `M${cx - 26 * k} ${T + 8 * k}`; for (let i = 0; i < 5; i++) { const x = cx - 26 * k + i * 13 * k; d += `L${x + 6.5 * k} ${T - (18 + (i === 2 ? 12 : i % 2 ? 6 : 0)) * k}L${x + 13 * k} ${T + 6 * k}`; } top += `<path d="${d}Z" fill="${c2}" ${st}/>`; }
    // pattern inside the body
    const P = rng(g.hue * 31 + g.hue2 * 7 + g.body);
    if (g.pattern === 1) for (let i = 0; i < 7; i++) { const a = P() * 6.28, r = (18 + P() * 34) * k; pat += `<circle cx="${cx + Math.cos(a) * r}" cy="${cy + Math.sin(a) * r * 0.9 + 6}" r="${(5 + P() * 7) * k}" fill="${c2}" opacity=".85"/>`; }
    if (g.pattern === 2) for (let i = -2; i <= 2; i++) { const y = cy + i * 22 * k + 6 * k; pat += `<path d="M${cx - 80} ${y}Q${cx - 30} ${y - 9 * k} ${cx} ${y}T${cx + 80} ${y}" fill="none" stroke="${c2}" stroke-width="${8 * k}" opacity=".75"/>`; }
    if (g.pattern === 3) pat += `<ellipse cx="${cx}" cy="${cy + 26 * k}" rx="${34 * k}" ry="${28 * k}" fill="${c2l}" opacity=".95"/>`;
    if (g.pattern === 4) for (let i = 0; i < 12; i++) { const s = i < 6 ? -1 : 1, j = i % 6; pat += `<circle cx="${cx + s * (30 + (j % 3) * 7) * k}" cy="${cy + 10 * k + Math.floor(j / 3) * 7 * k}" r="${2.2 * k}" fill="${c1d}"/>`; }
    // face
    const ey = cy - 4 * k, my = cy + 24 * k;
    const eye = (x, y, r, look = 0) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" ${S(3.5)}/>` + (dead ? `<path d="M${x - r * 0.5} ${y - r * 0.5}l${r} ${r}M${x + r * 0.5} ${y - r * 0.5}l${-r} ${r}" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>` : `<circle cx="${x + look}" cy="${y + r * 0.12}" r="${r * 0.52}" fill="${INK}"/><circle cx="${x + look + r * 0.2}" cy="${y - r * 0.15}" r="${r * 0.17}" fill="#fff"/>`);
    if (g.eyes === 0) face += eye(cx - 20 * k, ey, 12 * k, 1) + eye(cx + 20 * k, ey, 12 * k, 1);
    if (g.eyes === 1) face += eye(cx, ey - 4 * k, 21 * k, 1.5);
    if (g.eyes === 2) face += eye(cx - 25 * k, ey + 2 * k, 9.5 * k) + eye(cx, ey - 8 * k, 11 * k) + eye(cx + 25 * k, ey + 2 * k, 9.5 * k);
    if (g.eyes === 3) for (const s of [-1, 1]) face += `<path d="M${cx + s * 20 * k - 11 * k} ${ey}Q${cx + s * 20 * k} ${ey + 9 * k} ${cx + s * 20 * k + 11 * k} ${ey}" fill="none" ${st}/>`;
    if (g.eyes === 4) for (const s of [-1, 1]) face += eye(cx + s * 20 * k, ey + 2 * k, 11 * k) + `<path d="M${cx + s * 34 * k} ${ey - 14 * k}L${cx + s * 8 * k} ${ey - 6 * k}" ${S(5)}/>`;
    if (g.eyes === 5) for (const s of [-1, 1]) { const x = cx + s * 20 * k; face += `<circle cx="${x}" cy="${ey}" r="${12 * k}" fill="#fff" ${S(3.5)}/><path d="M${x} ${ey}m0 -1.5a1.5 1.5 0 1 1 -1.5 1.5a4 4 0 1 1 4 4a6.5 6.5 0 1 1 -6.5 -6.5" fill="none" stroke="${INK}" stroke-width="2.4" transform="translate(${x} ${ey}) scale(${k}) translate(${-x} ${-ey})"/>`; }
    if (g.eyes === 6) face += `<rect x="${cx - 40 * k}" y="${ey - 12 * k}" width="${80 * k}" height="${22 * k}" rx="${11 * k}" fill="${INK}"/><rect x="${cx - 30 * k}" y="${ey - 4 * k}" width="${60 * k}" height="${5 * k}" rx="${2.5 * k}" fill="${dead ? '#777' : c2l}"/>`;
    if (g.eyes === 7) face += eye(cx - 24 * k, ey - 2 * k, 15 * k, -1) + eye(cx + 24 * k, ey - 2 * k, 15 * k, 1);
    // cheeks
    if (!dead && g.eyes !== 6) for (const s of [-1, 1]) face += `<ellipse cx="${cx + s * 36 * k}" cy="${my - 6 * k}" rx="${7 * k}" ry="${4 * k}" fill="#FF6F91" opacity=".45"/>`;
    const mw = 15 * k;
    if (dead) face += `<path d="M${cx - mw} ${my + 4 * k}Q${cx} ${my - 6 * k} ${cx + mw} ${my + 4 * k}" fill="none" ${st}/>`;
    else {
      if (g.mouth === 0) face += `<path d="M${cx - mw} ${my - 2 * k}Q${cx} ${my + 12 * k} ${cx + mw} ${my - 2 * k}" fill="none" ${st}/>`;
      if (g.mouth === 1) face += `<path d="M${cx - mw - 2 * k} ${my - 3 * k}Q${cx} ${my + 13 * k} ${cx + mw + 2 * k} ${my - 3 * k}Z" fill="${INK}" ${st}/><path d="M${cx - 9 * k} ${my}l${3.5 * k} ${7 * k}l${3.5 * k} ${-6.5 * k}ZM${cx + 2 * k} ${my + 0.5 * k}l${3.5 * k} ${6.5 * k}l${3.5 * k} ${-7 * k}Z" fill="#fff"/>`;
      if (g.mouth === 2) face += `<ellipse cx="${cx}" cy="${my + 2 * k}" rx="${7 * k}" ry="${9 * k}" fill="${INK}"/>`;
      if (g.mouth === 3) face += `<path d="M${cx - mw - 2 * k} ${my}l${6 * k} ${-5 * k}l${6 * k} ${6 * k}l${6 * k} ${-6 * k}l${6 * k} ${6 * k}l${6 * k} ${-6 * k}" fill="none" ${S(3.6)}/>`;
      if (g.mouth === 4) face += `<path d="M${cx - mw} ${my - 3 * k}Q${cx} ${my + 15 * k} ${cx + mw} ${my - 3 * k}Z" fill="${INK}" ${st}/><path d="M${cx - 6 * k} ${my + 3 * k}Q${cx} ${my + 16 * k} ${cx + 7 * k} ${my + 3 * k}" fill="#FF5C7A" stroke="${INK}" stroke-width="2.5"/>`;
      if (g.mouth === 5) face += `<path d="M${cx - 11 * k} ${my + 2 * k}L${cx + 11 * k} ${my + 2 * k}" ${st}/>`;
      if (g.mouth === 6) face += `<path d="M${cx - mw - 4 * k} ${my - 4 * k}Q${cx} ${my + 18 * k} ${cx + mw + 4 * k} ${my - 4 * k}Z" fill="#fff" ${st}/><path d="M${cx - mw} ${my + 1 * k}L${cx + mw} ${my + 1 * k}" stroke="${INK}" stroke-width="2.4"/>`;
    }
    let bg = '';
    if (opts.bg) bg = `<rect width="200" height="200" fill="${typeof opts.bg === 'string' ? opts.bg : hsl(g.hue2, dead ? 0 : 55, 90)}"/>`;
    const gid = 'g' + id, cid = 'k' + id;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"${opts.size ? ` width="${opts.size}" height="${opts.size}"` : ''}>${bg}`
      + `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1l}"/><stop offset=".55" stop-color="${c1}"/><stop offset="1" stop-color="${c1d}"/></linearGradient><clipPath id="${cid}"><path d="${B.d}"/></clipPath></defs>`
      + `<ellipse cx="${cx}" cy="${Math.min(194, B.bottom + 12 * k)}" rx="${46 * k}" ry="${6 * k}" fill="${INK}" opacity=".14"/>`
      + back + top
      + `<path d="${B.d}" fill="url(#${gid})"/><g clip-path="url(#${cid})">${pat}<ellipse cx="${cx - 22 * k}" cy="${B.top + 24 * k}" rx="${18 * k}" ry="${10 * k}" fill="#fff" opacity=".35" transform="rotate(-24 ${cx - 22 * k} ${B.top + 24 * k})"/></g><path d="${B.d}" fill="none" ${st}/>`
      + face + `</svg>`;
  }

  function random(seed) {
    const r = rng(seed == null ? (Math.random() * 4294967296) >>> 0 : typeof seed === 'string' ? hashStr(seed) : seed);
    const p = (a) => Math.floor(r() * a.length);
    const h = HUES[p(HUES)];
    return clampG({ body: p(GENES.body), eyes: p(GENES.eyes), mouth: p(GENES.mouth), top: p(GENES.top), pattern: p(GENES.pattern), limbs: p(GENES.limbs), hue: h, hue2: (h + 120 + Math.floor(r() * 120)) % 360, size: 1 });
  }

  // child: every gene comes from one parent; each has a 15% chance to mutate. Returns { genome, from, mutated }
  function breed(a, b, seed) {
    a = clampG(a); b = clampG(b);
    const r = rng(seed == null ? (Math.random() * 4294967296) >>> 0 : typeof seed === 'string' ? hashStr(seed) : seed);
    const child = {}, from = {}, mutated = [];
    for (const k of [...Object.keys(GENES), 'hue', 'hue2', 'size']) {
      const pick = r() < 0.5 ? 'a' : 'b'; child[k] = (pick === 'a' ? a : b)[k]; from[k] = pick;
      if (r() < 0.15) {
        if (k === 'hue' || k === 'hue2') child[k] = (child[k] + 40 + Math.floor(r() * 280)) % 360;
        else if (k === 'size') child[k] = Math.floor(r() * 3);
        else child[k] = Math.floor(r() * GENES[k].length);
        mutated.push(k);
      }
    }
    if (from.hue !== from.hue2 && r() < 0.5) child.hue = Math.round((a.hue + b.hue) / 2 + (Math.abs(a.hue - b.hue) > 180 ? 180 : 0)) % 360;
    return { genome: clampG(child), from, mutated };
  }

  const api = { GENES, HUES, svg, random, breed, clean: clampG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Creature = api;
})(typeof window !== 'undefined' ? window : globalThis);
