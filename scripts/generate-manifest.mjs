#!/usr/bin/env node
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MEDIA_DIR = join(ROOT, 'media', 'amy');
const OUT = join(ROOT, 'media', 'manifest.json');

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const VID_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);

async function walk(dir, mediaRoot) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }

  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...await walk(full, mediaRoot));
    } else {
      const ext = extname(e.name).toLowerCase();
      const type = IMG_EXT.has(ext) ? 'image' : VID_EXT.has(ext) ? 'video' : null;
      if (!type) continue;
      const s = await stat(full);
      const rel = relative(mediaRoot, full).replaceAll('\\', '/');
      out.push({
        id: rel.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, ''),
        src: `media/${rel}`,
        filename: e.name,
        type,
        size: s.size,
        mtime: s.mtime.toISOString()
      });
    }
  }
  return out;
}

const items = await walk(MEDIA_DIR, join(ROOT, 'media'));
items.sort((a, b) => a.mtime.localeCompare(b.mtime));

const manifest = {
  generated: new Date().toISOString(),
  count: items.length,
  items
};

await writeFile(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const human = (n) => n.toLocaleString('es');
const totalMB = (items.reduce((s, i) => s + (i.size || 0), 0) / 1024 / 1024).toFixed(1);
const imgs = items.filter(i => i.type === 'image').length;
const vids = items.filter(i => i.type === 'video').length;

console.log('');
console.log('  amy · manifest generado');
console.log('  ──────────────────────────');
console.log(`    imágenes  ${human(imgs)}`);
console.log(`    videos    ${human(vids)}`);
console.log(`    total     ${human(items.length)}  (${totalMB} MB)`);
console.log(`    archivo   ${relative(ROOT, OUT)}`);
console.log('');
