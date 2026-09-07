'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const read = file => readFileSync(join(root, file));

test('generic desktop states do not assume every agent is Claude', () => {
  const app = read('src/renderer/src/App.tsx').toString();
  const quit = read('src/renderer/src/components/QuitWarningModal.tsx').toString();
  assert.doesNotMatch(app, /real claude output/i);
  assert.doesNotMatch(quit, /running claude session/i);
  assert.match(app, /Startup is paused while subscription-only safeguards are completed/);
  assert.match(quit, /provider-persisted conversation history remain on disk/);
});

test('Mac Dock PNG declares a full-size alpha channel and development uses it', () => {
  const png = read('build/icon-macos.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(png[25], 6, 'RGBA, not an opaque RGB or painted checkerboard export');
  assert.match(read('src/main/index.ts').toString(), /const dockIcon = join\(app.getAppPath\(\), 'build', 'icon-macos.png'\)/);
});

test('packaged ICNS retains a full-resolution alpha PNG for the Dock', () => {
  const icns = read('build/icon.icns');
  assert.equal(icns.subarray(0, 4).toString(), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  let full;
  for (let offset = 8; offset < icns.length;) {
    const length = icns.readUInt32BE(offset + 4);
    assert.ok(length >= 8 && offset + length <= icns.length);
    if (icns.toString('ascii', offset, offset + 4) === 'ic10') full = icns.subarray(offset + 8, offset + length);
    offset += length;
  }
  assert.ok(full, '1024px ICNS representation is required');
  // iconutil re-encodes PNG metadata/compression; encoded bytes need not match.
  assert.equal(full.subarray(1, 4).toString(), 'PNG');
  assert.equal(full.readUInt32BE(16), 1024);
  assert.equal(full.readUInt32BE(20), 1024);
  assert.equal(full[25], 6);
});
