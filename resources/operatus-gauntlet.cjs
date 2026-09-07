#!/usr/bin/env node
'use strict';

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const action = argv.shift();
const args = new Map();
for (let index = 0; index < argv.length; index += 2) {
  const key = argv[index];
  if (!key || !key.startsWith('--')) fail(`invalid argument: ${key || ''}`);
  const value = argv[index + 1];
  if (value == null) fail(`missing value for ${key}`);
  args.set(key.slice(2), value);
}

if (!['freeze', 'complete', 'commit', 'critic', 'acknowledge', 'cancel', 'escalate'].includes(action)) {
  fail('usage: operatus-gauntlet <freeze|complete|commit|critic|acknowledge|cancel|escalate> --run <id> [--launch <id>] [--file <json>]');
}
const {socketPath,token} = controlIdentity();
const runId = args.get('run');
if (!socketPath || !token) fail('Operatus control environment is unavailable; run this command inside an Operatus-launched agent');
if (!runId) fail('--run is required');

let payload = {};
if (args.has('file')) payload = JSON.parse(fs.readFileSync(args.get('file'), 'utf8'));
if (args.has('json')) payload = JSON.parse(args.get('json'));
if (action === 'complete') payload = { sha: args.get('sha') };
if (action === 'commit') payload = {expectedSha:args.get('expected-sha'),contractDigest:args.get('bar-digest'),message:args.get('message')};
if ((action === 'cancel' || action === 'escalate') && args.has('reason')) payload = { reason: args.get('reason') };

const request = {
  action: action === 'acknowledge' ? 'acknowledge' : action,
  runId,
  launchId: args.get('launch'),
  token,
  payload
};

const socket = net.createConnection(socketPath);
let response = '';
socket.setEncoding('utf8');
socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
socket.on('data', (chunk) => { response += chunk; });
socket.on('end', () => {
  let result;
  try { result = JSON.parse(response); } catch { fail(`invalid Operatus response: ${response.slice(0, 500)}`); }
  if (!result.ok) fail(result.error || 'Operatus command failed');
  const run = result.snapshot && result.snapshot.run;
  process.stdout.write(`${JSON.stringify({ ok: true, runId: run && run.id, status: run && run.status, phase: run && run.phase, artifactSha: run && run.currentArtifactSha }, null, 2)}\n`);
});
socket.on('error', (error) => fail(`cannot reach Operatus control socket: ${error.message}`));

function fail(message) {
  process.stderr.write(`operatus-gauntlet: ${message}\n`);
  process.exit(1);
}

function controlIdentity() {
  // Legacy launch environments remain supported. Never combine half of one
  // identity with half of another. Isolated launches use only the sidecar.
  if (process.env.OPERATUS_GAUNTLET_SOCKET || process.env.OPERATUS_GAUNTLET_TOKEN) {
    return {socketPath:process.env.OPERATUS_GAUNTLET_SOCKET,token:process.env.OPERATUS_GAUNTLET_TOKEN};
  }
  let fd;
  try {
    fd=fs.openSync(path.join(__dirname,'control-capability.json'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const stat=fs.fstatSync(fd);
    if (!stat.isFile() || stat.size>4096 || (stat.mode&0o077)!==0 ||
      (process.getuid && stat.uid!==process.getuid())) throw Error('invalid capability');
    const bytes=Buffer.alloc(stat.size+1);let size=0;
    while(size<bytes.length){const n=fs.readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}
    if(size!==stat.size)throw Error('changed capability');
    const identity=JSON.parse(bytes.subarray(0,size).toString('utf8'));
    if(identity.version!==1 || typeof identity.socketPath!=='string' || !path.isAbsolute(identity.socketPath) ||
      /[\u0000-\u001f\u007f]/.test(identity.socketPath) || typeof identity.token!=='string' ||
      !/^[a-zA-Z0-9_-]{32,256}$/.test(identity.token)) throw Error('invalid capability');
    return identity;
  } catch {
    fail('Operatus control environment is unavailable; run this command inside an Operatus-launched agent');
  } finally {if(fd!==undefined)fs.closeSync(fd);}
}
