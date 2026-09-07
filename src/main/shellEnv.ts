import { delimiter } from 'node:path';
import { executableDirectories, resolveExecutable } from './commandResolution';

/** Compatibility facade for legacy callers. No shell is launched and no rc
 * files are sourced. Configure an absolute path for custom CLI installations
 * outside the inherited PATH and known locations. This is discovery only,
 * never subscription admission or executable attestation. */
export function userShellPath(): string {
  return executableDirectories().join(delimiter);
}

export function resolveCommand(command: string): string {
  return resolveExecutable(command).path;
}
