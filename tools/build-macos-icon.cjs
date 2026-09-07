'use strict';

// Platform framing only. Never redraw or recolor the canonical source artwork.
// Pass a locally installed sharp module path if it is not on Node's lookup path.
const sharp = require(process.argv[2] || 'sharp');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

async function main() {
  const root = resolve(__dirname, '..');
  const source = readFileSync(join(root, 'build/icon.png'));
  const temp = mkdtempSync(join(tmpdir(), 'operatus-macos-icon-'));
  const iconset = join(temp, 'Operatus.iconset');
  mkdirSync(iconset);
  // Continuous-corner curve, 824px tile inside a transparent 1024px canvas.
  // The 100px optical margin prevents an oversized full-canvas Dock silhouette.
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><path fill="white" d="M 362 100 H 662 C 770 100 824 100 874 150 C 924 200 924 254 924 362 V 662 C 924 770 924 824 874 874 C 824 924 770 924 662 924 H 362 C 254 924 200 924 150 874 C 100 824 100 770 100 662 V 362 C 100 254 100 200 150 150 C 200 100 254 100 362 100 Z"/></svg>`);
  const png = await sharp(source).resize(824, 824, { kernel: 'nearest' })
    .ensureAlpha().extend({ top: 100, bottom: 100, left: 100, right: 100,
      background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  writeFileSync(join(root, 'build/icon-macos.png'), png);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      await sharp(png).resize(size * scale, size * scale)
        .png().toFile(join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')]);
  console.log(JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'),
    png: 'build/icon-macos.png', icns: 'build/icon.icns', intermediateIconset: iconset }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
