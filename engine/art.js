// Turns a creature's genome into a PNG (server side, with resvg's WebAssembly build: no native binaries)
// and stores it in Supabase Storage.
const fs = require('fs');
const C = require('../web/assets/creature.js');
const { uploadImage } = require('./images');
let ready = null;
async function init() {
  if (!ready) ready = (async () => { const R = require('@resvg/resvg-wasm'); await R.initWasm(fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))); return R; })();
  return ready;
}
async function png(genome, { size = 512, dead = false, bg = true } = {}) {
  const R = await init();
  return Buffer.from(new R.Resvg(C.svg(genome, { bg, dead, id: 'p' }), { fitTo: { mode: 'width', value: size } }).render().asPng());
}
async function storeAvatar(strain) {
  const buf = await png(strain.genome);
  return uploadImage('creatures/' + strain.id, buf, 'image/png');
}
module.exports = { png, storeAvatar };
