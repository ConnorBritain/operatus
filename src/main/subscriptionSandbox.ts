import { existsSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, sep } from 'node:path';
import type { prepareSubscriptionProfile } from './subscriptionProfile';
import type { PreparedControlClient } from './gauntlet/controlClient';

type PreparedProfile = Awaited<ReturnType<typeof prepareSubscriptionProfile>>;
export type SubscriptionRole = 'conductor' | 'implementer' | 'critic' | 'repairer';
const inside = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
function canonical(path: string): string {
  if (!isAbsolute(path) || /[\u0000-\u001f\u007f]/.test(path)) throw Error('invalid sandbox path');
  return realpathSync(path);
}

/** Outer process boundary, not Claude's optional tool sandbox. This initial
 * boundary denies external networking and does not authorize a provider launch.
 * Future subscription networking must be separately brokered
 * and verified before the global hold changes. Never add an unsandboxed fallback.
 * Caller must supply main-owned workspace/profile/executable identities.
 */
export function prepareSubscriptionSandbox(input: {
  artifact: string; profile: PreparedProfile; executable: string; role: SubscriptionRole;
  reviewEvidenceDirectory?: string;
  controlClient?: PreparedControlClient;
  /** Main-owned loopback gateway only. Not renderer configuration or admission. */
  providerBrokerPort?: number;
  /** Main-owned pinned native companion beside the copied Codex executable.
   * Caller verifies its digest before preparation, just like the main binary.
   * Never grant the containing directory or the installed app bundle. */
  codexCodeModeHost?: string;
}, platform = process.platform) {
  if (platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) throw Error('provider process sandbox unavailable');
  if (!['conductor', 'implementer', 'critic', 'repairer'].includes(input.role)) throw Error('unsupported provider role');
  const brokerPort = input.providerBrokerPort;
  if (brokerPort !== undefined && (!Number.isInteger(brokerPort) || brokerPort < 1 || brokerPort > 65535)) throw Error('invalid provider broker port');
  const artifact = canonical(input.artifact), directory = canonical(input.profile.directory);
  const home = canonical(input.profile.home), scratch = canonical(input.profile.scratch);
  const config = canonical(input.profile.configPath), providerHome = canonical(input.profile.providerHome);
  const executable = canonical(input.executable);
  const codeModeHost = input.codexCodeModeHost !== undefined ? canonical(input.codexCodeModeHost) : undefined;
  if (codeModeHost && (input.profile.receipt.provider !== 'codex' || codeModeHost !== input.codexCodeModeHost ||
    basename(codeModeHost) !== 'codex-code-mode-host' || dirname(codeModeHost) !== dirname(executable) ||
    codeModeHost === executable || !statSync(codeModeHost).isFile() ||
    [artifact, directory].some(root => inside(root, codeModeHost)))) {
    throw Error('invalid Codex Code Mode companion');
  }
  const evidence = input.reviewEvidenceDirectory ? canonical(input.reviewEvidenceDirectory) : undefined;
  const control = input.controlClient ? {
    socket:canonical(input.controlClient.socketPath), node:canonical(input.controlClient.nodePath), helper:canonical(input.controlClient.helperPath), credential:canonical(input.controlClient.credentialPath),
    launcher:input.controlClient.nodeLauncherPath ? canonical(input.controlClient.nodeLauncherPath) : undefined
  } : undefined;
  const runtimeBundleEnd = control?.node.indexOf('.app/Contents/') ?? -1;
  const runtimeRoot = control ? (runtimeBundleEnd >= 0 ? control.node.slice(0,runtimeBundleEnd+4) : control.node) : undefined;
  if (control && (!statSync(control.socket).isSocket() || !statSync(control.node).isFile() || !statSync(control.helper).isFile() || !statSync(control.credential).isFile() ||
    [artifact,home,scratch].some(root=>[control.helper,control.credential,runtimeRoot!,control.socket].some(path=>inside(root,path)||inside(path,root))))) {
    throw Error('invalid or writable control client capability');
  }
  const launcher = control?.launcher;
  if (launcher && (!statSync(launcher).isFile() ||
    launcher !== `${dirname(control!.helper)}/bin/node` ||
    [artifact,home,scratch].some(root=>inside(root,launcher)))) throw Error('invalid or writable Node launcher');
  if (evidence && (!statSync(evidence).isDirectory() || [artifact, directory].some(root => inside(root, evidence) || inside(evidence, root)))) {
    throw Error('review evidence overlaps a provider root');
  }
  if (!statSync(artifact).isDirectory() || !statSync(directory).isDirectory() ||
    !inside(directory, home) || directory === home || !inside(directory, scratch) || directory === scratch ||
    !inside(home, providerHome) || home === providerHome || !inside(providerHome, config) ||
    inside(home, scratch) || inside(scratch, home) || inside(artifact, directory) || inside(directory, artifact) ||
    inside(artifact, executable) || inside(home, executable) || inside(scratch, executable)) {
    throw Error('provider sandbox roots overlap or are invalid');
  }
  const q = JSON.stringify;
  const writable = input.role === 'implementer' || input.role === 'repairer';
  const profile = `(version 1)
(deny default)
(allow process-exec process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/System/Library") (subpath "/System/Cryptexes")
  (subpath "/usr/lib") (subpath "/usr/bin") (subpath "/usr/share/locale") (subpath "/usr/share/icu")
  (subpath "/private/var/db/timezone")
  (subpath "/bin") (subpath "/sbin") (subpath "/private/var/db/dyld")
  (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random")
  (literal ${q(executable)})${codeModeHost ? ` (literal ${q(codeModeHost)})` : ''} (subpath ${q(artifact)}) (subpath ${q(home)}) (subpath ${q(scratch)})${evidence ? ` (subpath ${q(evidence)})` : ''}${control ? `
  (literal ${q(control.helper)}) (literal ${q(control.credential)})${control.launcher ? ` (literal ${q(control.launcher)})` : ''} (${runtimeBundleEnd>=0?'subpath':'literal'} ${q(runtimeRoot!)})` : ''})
(allow file-write* (literal "/dev/null") (subpath ${q(home)}) (subpath ${q(scratch)})${writable ? ` (subpath ${q(artifact)})` : ''})
; Neither provider settings nor Git metadata belong to worker tools.
(deny file-write* (literal ${q(config)}) (literal ${q(providerHome)}) (literal ${q(home)}))
(deny file-write* (literal ${q(`${providerHome}/skills`)}) (subpath ${q(`${providerHome}/skills`)}))
(deny file-write* (literal ${q(`${artifact}/.git`)}) (subpath ${q(`${artifact}/.git`)}))
${control ? `(allow system-socket (socket-domain AF_UNIX))
(allow network-outbound (remote unix-socket (literal ${q(control.socket)})))` : ''}
; The optional gateway is loopback-only. Its server must reject unauthorized
; requests independently: worker children inherit this port capability too.
${brokerPort !== undefined ? `(allow system-socket (socket-domain AF_INET))
(allow network-outbound (remote ip "localhost:${brokerPort}"))` : ''}
`;
  return {
    command: '/usr/bin/sandbox-exec', args: ['-p', profile, executable], cwd: artifact,
    receipt: Object.freeze({ component:'macos-provider-offline-v1' as const, role:input.role,
      artifactAccess:writable ? 'working-files-write' as const : 'read-only' as const,
      gitMetadataWrite:'denied' as const, network:brokerPort!==undefined?'scoped-local-gateways-only' as const:control?'control-socket-only' as const:'denied' as const,
      profileSha256:createHash('sha256').update(profile).digest('hex'), launchAllowed:false as const })
  };
}
