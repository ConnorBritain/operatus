import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { prepareSubscriptionProfile } from '../subscriptionProfile';

export interface PreparedControlClient {
  socketPath: string;
  nodePath: string;
  /** Main-owned launcher; sets Node mode even with a replacement child env. */
  nodeLauncherPath?: string;
  helperPath: string;
  credentialPath: string;
}

export function controlNodeEnvironment(client: PreparedControlClient) {
  return { HIVE_NODE: client.nodeLauncherPath ?? client.nodePath, ELECTRON_RUN_AS_NODE: '1',
    PATH: `${client.nodeLauncherPath ? `${dirname(client.nodeLauncherPath)}:` : ''}/usr/bin:/bin:/usr/sbin:/sbin` };
}

/** Main-owned materialization. No personal Node setup or provider credentials.
 * Caller supplies the inspected build-helper digest and scoped launch token.
 * The launch-scoped control capability is a private, read-only sidecar outside
 * worker-writable roots. It is not an account credential and never enters the
 * helper source, receipt, arguments, or subprocess environment.
 */
export function prepareControlClient(input: {
  profile: Awaited<ReturnType<typeof prepareSubscriptionProfile>>;
  socketPath: string; nodePath: string; helperSource: string; expectedHelperSha256: string; token: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.expectedHelperSha256) || typeof input.token !== 'string' ||
    !/^[a-zA-Z0-9_-]{32,256}$/.test(input.token)) throw new Error('invalid main-owned control identity');
  const fd = openSync(input.helperSource, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let content: Buffer;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 128*1024) throw new Error('invalid control helper');
    const bytes = Buffer.alloc(stat.size+1);let size=0;
    while (size<bytes.length) {const count=readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}
    if (size!==stat.size) throw new Error('control helper changed');
    content=bytes.subarray(0,size);
  } finally {closeSync(fd);}
  if (createHash('sha256').update(content).digest('hex')!==input.expectedHelperSha256) throw new Error('control helper identity changed');
  const directory=join(realpathSync(input.profile.directory),'control-client');
  mkdirSync(directory,{mode:0o700});
  const helperPath=join(directory,'operatus-gauntlet.cjs');
  writeFileSync(helperPath,content,{flag:'wx',mode:0o400});
  const credentialPath=join(directory,'control-capability.json');
  const nodePath=realpathSync(input.nodePath), bin=join(directory,'bin');
  mkdirSync(bin,{mode:0o700});
  const nodeLauncherPath=join(bin,'node');
  const launcher=`#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec '${nodePath.replace(/'/g, "'\\''")}' "$@"\n`;
  writeFileSync(nodeLauncherPath,launcher,{flag:'wx',mode:0o500});
  const capability: PreparedControlClient = {
    socketPath:realpathSync(input.socketPath),nodePath,nodeLauncherPath,helperPath,credentialPath
  };
  writeFileSync(credentialPath,JSON.stringify({version:1,socketPath:capability.socketPath,token:input.token}),{flag:'wx',mode:0o400});
  return {
    capability,
    env:{...input.profile.env,...controlNodeEnvironment(capability),
      OPERATUS_GAUNTLET_HELPER:helperPath},
    receipt:{component:'scoped-local-control-client-v1' as const,helperSha256:input.expectedHelperSha256,launchAllowed:false as const}
  };
}
