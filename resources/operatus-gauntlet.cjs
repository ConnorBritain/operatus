#!/usr/bin/env node
'use strict';

const net = require('node:net');
const fs = require('node:fs');

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

if (!['freeze', 'complete', 'critic', 'acknowledge', 'cancel', 'escalate'].includes(action)) {
  fail('usage: operatus-gauntlet <freeze|complete|critic|acknowledge|cancel|escalate> --run <id> [--launch <id>] [--file <json>]');
}
const socketPath = process.env.OPERATUS_GAUNTLET_SOCKET;
const token = process.env.OPERATUS_GAUNTLET_TOKEN;
const runId = args.get('run');
if (!socketPath || !token) fail('Operatus control environment is unavailable; run this command inside an Operatus-launched agent');
if (!runId) fail('--run is required');

let payload = {};
if (args.has('file')) payload = JSON.parse(fs.readFileSync(args.get('file'), 'utf8'));
if (args.has('json')) payload = JSON.parse(args.get('json'));
if (action === 'complete') payload = { sha: args.get('sha') };
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
