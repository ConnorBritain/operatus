#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const release = readFileSync(join(root, 'RELEASE.md'), 'utf8');
const failures = [];

if (!release.includes(`Operatus ${pkg.version}`)) failures.push(`RELEASE.md does not identify Operatus ${pkg.version}`);
if (!release.includes('not yet a published installer release')) failures.push('development milestone must explicitly say no installer release is published');
if (/releases\/latest\/download\//.test(release)) failures.push('RELEASE.md advertises a latest-release asset before publication');
if (!release.includes('git@github.com:ConnorBritain/operatus.git')) failures.push('RELEASE.md does not point to the Operatus repository');

if (process.argv.includes('--live')) failures.push('--live is unavailable until an Operatus installer release exists');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Operatus ${pkg.version} development release metadata is internally consistent.`);
}
