import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, win32 } from 'node:path';
import { homedir } from 'node:os';

/** Adapted from upstream ea7e0d2f's command-token boundary. Leading options,
 * relative paths and shell programs are not executable names. Unlike upstream,
 * discovery below never invokes which/where or an interactive shell. */
export function isSafeCommandName(command: string): boolean {
  return typeof command === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/.test(command);
}

export function isExecutableReference(command: string, platform = process.platform): boolean {
  return typeof command === 'string' && !/[\u0000-\u001f\u007f]/.test(command) &&
    (isSafeCommandName(command) || (platform === 'win32' ? win32.isAbsolute(command) : isAbsolute(command)));
}

export interface DiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  directories?: string[];
}

/** No empty/relative PATH entries: do not search a project checkout implicitly. */
export function executableDirectories(options: DiscoveryOptions = {}): string[] {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const common = process.platform === 'win32'
    ? [env.APPDATA ? join(env.APPDATA, 'npm') : '', env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'claude') : '',
      join(home, '.local', 'bin'), join(home, '.claude', 'local')]
    : [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(home, '.claude', 'local'),
      join(home, '.volta', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return [...new Set((options.directories ?? [...(env.PATH ?? '').split(delimiter), ...common])
    .filter(dir => isAbsolute(dir) && !/[\u0000-\u001f\u007f]/.test(dir)))].slice(0, 128);
}

export function discoverExecutables(command: string, options: DiscoveryOptions = {}): string[] {
  if (!isExecutableReference(command)) return [];
  const env = options.env ?? process.env;
  // Restrict Windows discovery to executable/shim suffixes. Ignore hostile or
  // non-executable PATHEXT values; shim execution is a separate boundary.
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(ext => ext.toLowerCase())
      .filter(ext => /^\.(com|exe|bat|cmd)$/.test(ext)) : [];
  const candidates = isAbsolute(command) ? [command] : executableDirectories(options).flatMap(dir => {
    if (process.platform !== 'win32') return [join(dir, command)];
    return extensions.some(ext => command.toLowerCase().endsWith(ext))
      ? [join(dir, command)] : extensions.map(ext => join(dir, `${command}${ext}`));
  });
  const result = new Set<string>();
  for (const candidate of candidates) {
    try {
      const path = realpathSync(candidate);
      if (!statSync(path).isFile()) continue;
      accessSync(path, process.platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK);
      result.add(path);
    } catch { /* absent, dangling link, directory or not executable */ }
  }
  return [...result];
}

export function resolveExecutable(command: string): { path: string; found: boolean } {
  const path = discoverExecutables(command)[0];
  return { path: path ?? command, found: !!path };
}
