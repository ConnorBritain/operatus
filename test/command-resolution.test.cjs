'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, delimiter } = require('node:path');
const { tmpdir } = require('node:os');
const load = require('./load-ts.cjs');
const { isSafeCommandName, isExecutableReference, discoverExecutables, executableDirectories, resolveExecutable } = load('src/main/commandResolution.ts');

test('names exclude shell programs, options and relative paths; absolute paths remain literal', () => {
  for (const name of ['claude', 'codex', 'node-22', 'agent_tool.exe', 'g++']) assert.ok(isSafeCommandName(name));
  for (const name of ['', '-a', '--help', '.', '..', './claude', '../claude', 'a b', 'a;b', 'a|b', 'a&b', 'a\nb', 'a`b`', '$(id)', '${PATH}', 'a>b']) {
    assert.equal(isSafeCommandName(name), false, name);
    assert.deepEqual(discoverExecutables(name, { directories: [] }), [], name);
  }
  assert.equal(isExecutableReference('/Applications/An App/cli', 'darwin'), true);
  assert.equal(isExecutableReference('C:\\Tools\\Agent App\\claude.exe', 'win32'), true);
  assert.equal(isExecutableReference('C:relative.exe', 'win32'), false);
  assert.equal(isExecutableReference('/tmp/a\nb', 'darwin'), false);
});

test('filesystem discovery rejects directories/nonexecutables and deduplicates real targets', { skip: process.platform === 'win32' }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'operatus-cli-resolution-')));
  const dirs = ['first', 'second', 'duplicate', 'directory', 'nonexec'].map(name => join(root, name));
  dirs.forEach(dir => fs.mkdirSync(dir));
  for (const dir of dirs.slice(0, 2)) fs.writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 91\n', { mode: 0o700 });
  fs.symlinkSync(join(dirs[0], 'claude'), join(dirs[2], 'claude'));
  fs.mkdirSync(join(dirs[3], 'claude'));
  fs.writeFileSync(join(dirs[4], 'claude'), 'not executable', { mode: 0o600 });
  assert.deepEqual(discoverExecutables('claude', { directories: dirs }), [join(dirs[0], 'claude'), join(dirs[1], 'claude')]);
  assert.deepEqual(discoverExecutables(join(dirs[1], 'claude'), { directories: [] }), [join(dirs[1], 'claude')]);
});

test('PATH order is explicit; empty/relative project entries are never searched', () => {
  const dirs = executableDirectories({ home: '/fixture/home', env: { PATH: ['/first', '', '.', 'relative', '/second', '/first'].join(delimiter) } });
  assert.deepEqual(dirs.slice(0, 2), ['/first', '/second']);
  assert.equal(dirs.some(dir => ['', '.', 'relative'].includes(dir)), false);
});

test('discovery runs no subprocess and does not source hostile shell configuration', { skip: process.platform === 'win32' }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'operatus-cli-noshell-')));
  fs.writeFileSync(join(root, 'claude'), '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  const cp = require('node:child_process');
  const savedMethods = {};
  const oldPath = process.env.PATH, oldShell = process.env.SHELL, oldBashEnv = process.env.BASH_ENV;
  let attempts = 0;
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
    savedMethods[method] = cp[method];
    cp[method] = () => { attempts++; throw Error('subprocess forbidden'); };
  }
  try {
    process.env.PATH = root;
    process.env.SHELL = '/untrusted/shell';
    process.env.BASH_ENV = '/untrusted/profile';
    const shell = load('src/main/shellEnv.ts');
    assert.equal(shell.resolveCommand('claude'), join(root, 'claude'));
    assert.ok(shell.userShellPath().split(delimiter).includes(root));
    assert.equal(resolveExecutable('claude;touch sentinel').found, false);
    assert.equal(attempts, 0);
  } finally {
    for (const [method, value] of Object.entries(savedMethods)) cp[method] = value;
    for (const [key, value] of [['PATH', oldPath], ['SHELL', oldShell], ['BASH_ENV', oldBashEnv]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('resolution rechecks changed PATH and deleted targets instead of retaining positive cache', { skip: process.platform === 'win32' }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'operatus-cli-freshness-')));
  const a = join(root, 'a'), b = join(root, 'b'); fs.mkdirSync(a); fs.mkdirSync(b);
  const name = 'operatus-test-only-cli';
  fs.writeFileSync(join(a, name), 'first', { mode: 0o700 }); fs.writeFileSync(join(b, name), 'second', { mode: 0o700 });
  const old = process.env.PATH;
  try {
    process.env.PATH = a; assert.equal(resolveExecutable(name).path, join(a, name));
    process.env.PATH = b; assert.equal(resolveExecutable(name).path, join(b, name));
    fs.unlinkSync(join(b, name)); assert.equal(resolveExecutable(name).found, false);
  } finally { if (old === undefined) delete process.env.PATH; else process.env.PATH = old; }
});
