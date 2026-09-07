#!/usr/bin/env node
'use strict';

// A local build installer, not an updater service. Never touches userData or Git.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const DESTINATION = '/Applications/Operatus.app';
const STORAGE = '/Applications/.operatus-local-updates';
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.signal}). The installed app was not intentionally replaced.`);
}

function assertPlainDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a real directory: ${directory}`);
}

function acquireLock(storage) {
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  assertPlainDirectory(storage);
  const lock = path.join(storage, 'refresh.lock');
  try { fs.mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another refresh may be running. Lock: ${lock}. Do not remove it until that process is confirmed stopped.`);
    throw error;
  }
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return () => fs.rmSync(lock, { recursive: true });
}

function isAppRunning(destination = DESTINATION, output) {
  const processes = output ?? execFileSync('/bin/ps', ['-ax', '-o', 'comm='], { encoding: 'utf8' });
  return processes.split('\n').some(line => line.trim().startsWith(`${destination}/Contents/`));
}

// Check again immediately before the swap; never kill agents or force-quit the app.
function swapBundle(candidate, destination, backup, running = isAppRunning, rename = fs.renameSync) {
  assertPlainDirectory(candidate);
  if (fs.existsSync(backup)) throw new Error('Backup already exists; refusing to overwrite it.');
  if (fs.existsSync(destination)) assertPlainDirectory(destination);
  if (running(destination)) throw new Error('Quit Operatus normally before installing. The prepared build is retained.');
  const hadPrevious = fs.existsSync(destination);
  if (hadPrevious) rename(destination, backup);
  try { rename(candidate, destination); } catch (error) {
    if (hadPrevious) rename(backup, destination);
    throw error;
  }
}

function validateBundle(bundle) {
  assertPlainDirectory(bundle);
  const plist = path.join(bundle, 'Contents/Info.plist');
  const id = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist], { encoding: 'utf8' }).trim();
  if (id !== 'com.connorbritain.operatus') throw new Error('Unexpected application identity.');
  const resources = path.join(bundle, 'Contents/Resources');
  for (const relative of ['app.asar', 'operatus-gauntlet.cjs', 'agent-primitives']) {
    if (!fs.existsSync(path.join(resources, relative))) throw new Error(`Missing bundled resource: ${relative}`);
  }
  const probe = `const {createRequire}=require('node:module');const r=createRequire(${JSON.stringify(path.join(resources, 'app.asar/package.json'))});const D=r('better-sqlite3');const db=new D(':memory:');if(db.prepare('select 1 as ok').get().ok!==1)throw Error('SQLite');db.close();const p=r('node-pty').spawn('/usr/bin/true',[],{name:'xterm',cols:80,rows:24,cwd:'/tmp',env:{PATH:'/usr/bin:/bin'}});const t=setTimeout(()=>process.exit(2),10000);p.onExit(e=>{clearTimeout(t);process.exit(e.exitCode)});`;
  run(path.join(bundle, 'Contents/MacOS/Operatus'), ['-e', probe], {
    env: { PATH: '/usr/bin:/bin', HOME: os.homedir(), ELECTRON_RUN_AS_NODE: '1' }, timeout: 15000,
  });
  return digest(path.join(resources, 'app.asar'));
}

function preparedPaths(storage) {
  const receipt = JSON.parse(fs.readFileSync(path.join(storage, 'prepared.json'), 'utf8'));
  if (!/^build-[a-zA-Z0-9]+$/.test(receipt.directory)) throw new Error('Invalid prepared build path.');
  const directory = path.join(storage, receipt.directory);
  assertPlainDirectory(directory);
  const bundle = path.join(directory, 'mac-arm64/Operatus.app');
  if (validateBundle(bundle) !== receipt.asarSha256) throw new Error('Prepared build changed since verification.');
  return { receipt, bundle };
}

function applyPrepared(storage = STORAGE, destination = DESTINATION) {
  const { bundle, receipt } = preparedPaths(storage);
  const backup = path.join(storage, `previous-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.app`);
  swapBundle(bundle, destination, backup);
  // Bundle swap has succeeded. Receipt failures must not undo a good installation.
  fs.writeFileSync(path.join(storage, 'installed.json'), JSON.stringify({ ...receipt, installedAt: new Date().toISOString(), backup: fs.existsSync(backup) ? backup : null }, null, 2));
  fs.unlinkSync(path.join(storage, 'prepared.json'));
  console.log(`Updated ${destination}\nPrevious app retained: ${backup}\nYour settings, logins, worktrees, and run history were not reset.\nOpen Operatus from the Dock or Applications when ready.`);
}

function prepare(storage = STORAGE) {
  if (fs.existsSync(path.join(storage, 'prepared.json'))) {
    throw new Error('A verified build is already waiting. Use --apply before preparing another build.');
  }
  const space = fs.statfsSync('/Applications');
  if (Number(space.bavail) * Number(space.bsize) < 2 * 1024 ** 3) throw new Error('At least 2 GiB free is required to prepare a local update. No old app or backup was deleted.');
  const npm = path.join(path.dirname(fs.realpathSync(process.execPath)), 'npm');
  if (!fs.existsSync(npm)) throw new Error('npm must be installed alongside Node.');
  const buildEnv = { ...process.env, PATH: `${path.dirname(fs.realpathSync(process.execPath))}:${process.env.PATH || '/usr/bin:/bin'}`, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  for (const key of Object.keys(buildEnv)) if (/^(APPLE_|CSC_)/.test(key) && key !== 'CSC_IDENTITY_AUTO_DISCOVERY') delete buildEnv[key];
  delete buildEnv.ELECTRON_RUN_AS_NODE;
  console.log('1/3 Checking and building the current local code. No Git pull or release upload.');
  run(npm, ['run', 'typecheck'], { env: buildEnv });
  run(npm, ['run', 'build'], { env: buildEnv });
  const directory = fs.mkdtempSync(path.join(storage, 'build-'));
  console.log('2/3 Packaging an unsigned Apple Silicon app. The installed app stays untouched.');
  const config = { extends: path.join(ROOT, 'electron-builder.yml'), afterSign: null, npmRebuild: false, mac: { identity: null }, directories: { output: directory } };
  const builder = `const b=require('electron-builder');b.build({targets:b.Platform.MAC.createTarget('dir',b.Arch.arm64),publish:'never',config:${JSON.stringify(config)}}).catch(e=>{console.error(e);process.exitCode=1});`;
  run(process.execPath, ['-e', builder], { env: buildEnv });
  console.log('3/3 Verifying application identity, SQLite, and terminal support. No AI agents are started.');
  const bundle = path.join(directory, 'mac-arm64/Operatus.app');
  const asarSha256 = validateBundle(bundle);
  const asar = require('@electron/asar');
  for (const file of ['out/main/index.js', 'out/preload/index.js']) {
    const packed = crypto.createHash('sha256').update(asar.extractFile(path.join(bundle, 'Contents/Resources/app.asar'), file)).digest('hex');
    if (packed !== digest(path.join(ROOT, file))) throw new Error(`Packaged ${file} does not match the build.`);
  }
  const receipt = { directory: path.basename(directory), asarSha256, builtAt: new Date().toISOString(), source: ROOT, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), workingTreeMayIncludeLocalEdits: true };
  fs.writeFileSync(path.join(storage, 'prepared.json'), JSON.stringify(receipt, null, 2));
  console.log('Build verified and ready.');
}

function rollback(storage = STORAGE, destination = DESTINATION) {
  const installed = JSON.parse(fs.readFileSync(path.join(storage, 'installed.json'), 'utf8'));
  const backup = installed.backup;
  if (typeof backup !== 'string' || path.dirname(backup) !== storage || !/^previous-[0-9]+-[a-f0-9]+\.app$/.test(path.basename(backup))) throw new Error('No valid recorded previous app.');
  validateBundle(backup);
  const displaced = path.join(storage, `previous-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.app`);
  swapBundle(backup, destination, displaced);
  fs.writeFileSync(path.join(storage, 'installed.json'), JSON.stringify({ rolledBackAt: new Date().toISOString(), backup: displaced }, null, 2));
  console.log('Previous app restored. App data was NOT rolled back. Older code may not understand newer database migrations.');
}

function installLauncher() {
  const directory = path.join(os.homedir(), 'Applications');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'Refresh Operatus.command');
  // wx prevents replacing a user-owned launcher without review.
  fs.writeFileSync(file, `#!/bin/bash\n# Generated by Operatus local refresh. No reset, signing, or publishing.\n${shellQuote(fs.realpathSync(process.execPath))} ${shellQuote(__filename)}\nresult=$?\nprintf '\\nPress Return to close this window.'\nread -r reply\nexit "$result"\n`, { flag: 'wx', mode: 0o755 });
  console.log(`Double-click launcher installed: ${file}`);
}

async function main(args) {
  if (args.length > 1 || (args.length && !['--prepare', '--apply', '--rollback', '--install-launcher', '--help'].includes(args[0]))) throw new Error('Use --help for supported options.');
  if (args[0] === '--help') {
    console.log('Refresh Operatus locally. Default: build (or reuse a prepared build), then install if the app is closed.\n--prepare: build only\n--apply: install prepared build; app must be closed\n--rollback: restore recorded previous app; app must be closed (does not undo database migrations)\n--install-launcher: create ~/Applications/Refresh Operatus.command\nNo Git pulls, forced quits, profile resets, signing, or publishing.');
    return;
  }
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This local refresh tool currently supports Apple Silicon macOS only.');
  if (args[0] === '--install-launcher') return installLauncher();
  const unlock = acquireLock(STORAGE);
  try {
    if (args[0] === '--rollback') return rollback();
    if (args[0] === '--apply') return applyPrepared();
    if (!fs.existsSync(path.join(STORAGE, 'prepared.json')) || args[0] === '--prepare') prepare();
    if (args[0] === '--prepare') return;
    if (isAppRunning()) {
      console.log('Ready to install. Finish your work and quit Operatus normally, then run Refresh Operatus again. It will use this verified build without rebuilding.');
      return;
    }
    applyPrepared();
  } finally { unlock(); }
}

module.exports = { acquireLock, isAppRunning, swapBundle, shellQuote, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(`Refresh stopped: ${error.message}`); process.exitCode = 1; });
