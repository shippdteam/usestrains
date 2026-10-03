// Coin images live in your Supabase Storage (public bucket "coins"), so pages never depend on IPFS.
const BUCKET = 'strains';
const base = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
async function uploadImage(name, buffer, contentType) {
  const ext = /svg/.test(contentType) ? 'svg' : /jpe?g/.test(contentType) ? 'jpg' : /webp/.test(contentType) ? 'webp' : /gif/.test(contentType) ? 'gif' : 'png';
  const path = `${name}.${ext}`, KEY = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${base()}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': contentType || 'image/png', 'x-upsert': 'true', 'cache-control': '31536000' }, body: buffer });
  if (!r.ok) throw new Error('Image upload failed (' + r.status + '): ' + (await r.text()).slice(0, 200) + ' — did you run the SQL that makes the "strains" bucket?');
  return `${base()}/storage/v1/object/public/${BUCKET}/${path}`;
}
module.exports = { uploadImage };
