'use strict';

const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const root = join(__dirname, '..');
const assetRoot = join(root, 'src', 'renderer', 'src', 'assets');
const forbiddenNames = new Set([
  'Adam_walk.png', 'Alex_walk.png', 'Amelia_walk.png', 'Bob_walk.png',
  'brooklyn99.tmj', 'lobby.tmj', 'office.tmj',
  'A2 Office Floors.png', 'A4 Office Walls.png', 'LIMEZUASSETS-LICENSE.txt',
  'a5-office-floors-walls.png', 'interiors.png', 'office-tileset.png', 'room-builder.png'
]);
const forbiddenHashes = new Set([
  '61cda32cb7ad43a98736cbf0c992fba2839721d556e8fbe87cfe32f425c2773e',
  '4b61ff711adc29351c73a034526677997eb16b58a7965ecdf44e584d47ddb1fe',
  '62d83634a7005ec93f7b8643fae4372d70ae41cd6cacac566e3e0d4075ff5674',
  'e028906383fdbe8316cc0367e1dc9d86f21aa0a74fe1b2065e0a2ac7ef31f6f8',
  '0fe41e76d075ccf3fd612f515812100e28b53b2665a92e44811d4c56a4ce8a1e',
  'f81a3d52c36e6b9e271b87bfb0077547dc079490740105c38295a89194622878',
  '4272e113b43cb833744f7d358283bc68a45e71089cf1baa38a502f24b63dc210',
  'f67ea68ff69da5210d7c658d9bf8737df7c9caefe46f491ca8d7a954b25ccea5',
  '991a7372a87f1bdb2757f1b2987279fe86ad661da68b1d1501c85b14d8001600',
  '7983d4b5782bd5ea80ead73310c92681f36b8d15bd2996ba5aff35953e656f3c',
  '95d448c5df9d726799abe8c3ce211ead27f8e503dca62f616e044b63aa42fa8e',
  '01a890f9e34d8dc8d7e275489143b837569127d5f928419e6b6edc54b9b5ff33',
  '6a7cf46b2883503d1be61c603b81a6f3844c02da8c7c7782b29d46cc55c367d0'
]);

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const failures = [];
for (const file of filesUnder(assetRoot)) {
  const bytes = readFileSync(file);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (forbiddenNames.has(file.split('/').at(-1))) failures.push(`forbidden legacy asset name: ${relative(root, file)}`);
  if (forbiddenHashes.has(digest)) failures.push(`forbidden legacy asset hash: ${relative(root, file)} (${digest})`);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'ventura') failures.push(`package name is ${JSON.stringify(pkg.name)}, expected "ventura"`);
if (!['https://github.com/ConnorBritain/ventura.git', 'git+https://github.com/ConnorBritain/ventura.git'].includes(pkg.repository?.url)) {
  failures.push('package repository does not point to ConnorBritain/ventura');
}

const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
for (const expected of ['appId: com.connorbritain.ventura', 'productName: Ventura']) {
  if (!builder.includes(expected)) failures.push(`electron-builder.yml is missing ${expected}`);
}

const rendererOut = join(root, 'out', 'renderer');
for (const file of filesUnder(rendererOut)) {
  if (!statSync(file).isFile() || !/\.(?:html|js|css|json)$/i.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const phrase of [
    'munder difflin', 'dunder mifflin', 'michael scott', 'dwight schrute',
    'jim halpert', 'pam beesly', 'world’s best boss', "world's best boss",
    "that's what she said"
  ]) {
    if (text.toLowerCase().includes(phrase)) failures.push(`visible legacy phrase ${JSON.stringify(phrase)} in ${relative(root, file)}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Ventura identity and redistributable asset checks passed.');
}
