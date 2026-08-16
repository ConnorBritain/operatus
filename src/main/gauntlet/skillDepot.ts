import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  DepotSkill,
  GauntletRole,
  RoleSkillAssignment,
  SkillDepotSource,
  SkillLockEntry,
  SkillLockReceipt
} from '../../shared/gauntlet';
import { assertFullSha, GauntletInvariantError } from './core';

export const MATT_POCKOCK_SKILLS_SOURCE: SkillDepotSource = {
  id: 'mattpocock-skills',
  url: 'https://github.com/mattpocock/skills.git',
  pinnedCommit: '068b6e0c62393147daf03530149cdce209c93da8',
  enabled: true,
  include: ['skills/engineering', 'skills/productivity'],
  optIn: ['skills/in-progress', 'skills/misc']
};

/** Git-backed, manually synchronized catalog. Sync never executes source code. */
export class SkillDepot {
  private readonly configPath: string;

  constructor(private readonly root: string, private readonly options: { allowFileSources?: boolean } = {}) {
    if (!isAbsolute(root)) throw new Error('SkillDepot root must be absolute');
    this.configPath = join(root, 'sources.json');
  }

  initialize(): void {
    mkdirSync(this.root, { recursive: true });
    if (!existsSync(this.configPath)) this.saveSources([MATT_POCKOCK_SKILLS_SOURCE]);
  }

  listSources(): SkillDepotSource[] {
    this.initialize();
    const parsed = JSON.parse(readFileSync(this.configPath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new GauntletInvariantError('Skill Depot source config is malformed');
    return parsed.map((source) => validateSource(source as SkillDepotSource, this.options.allowFileSources === true));
  }

  saveSources(sources: SkillDepotSource[]): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    const validated = sources.map((source) => validateSource(source, this.options.allowFileSources === true));
    const ids = new Set<string>();
    for (const source of validated) {
      if (ids.has(source.id)) throw new GauntletInvariantError(`duplicate Skill Depot source: ${source.id}`);
      ids.add(source.id);
    }
    writeFileSync(this.configPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  sync(sourceId: string): DepotSkill[] {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    if (!source) throw new GauntletInvariantError(`unknown Skill Depot source: ${sourceId}`);
    if (!source.enabled) throw new GauntletInvariantError(`Skill Depot source is disabled: ${sourceId}`);
    const checkout = join(this.root, 'checkouts', source.id);
    mkdirSync(dirname(checkout), { recursive: true });
    if (!existsSync(checkout)) {
      git(this.root, ['clone', '--no-checkout', '--filter=blob:none', source.url, checkout]);
    } else {
      const remote = git(checkout, ['remote', 'get-url', 'origin']).trim();
      if (normalizeGitUrl(remote) !== normalizeGitUrl(source.url)) {
        throw new GauntletInvariantError(`Skill Depot remote mismatch for ${source.id}`);
      }
    }
    git(checkout, ['fetch', '--depth=1', 'origin', source.pinnedCommit]);
    git(checkout, ['checkout', '--detach', '--force', source.pinnedCommit]);
    const actual = git(checkout, ['rev-parse', 'HEAD']).trim();
    if (actual !== source.pinnedCommit) throw new GauntletInvariantError(`Skill Depot pin mismatch for ${source.id}`);
    return this.discover(source);
  }

  discover(source: SkillDepotSource): DepotSkill[] {
    const checkout = join(this.root, 'checkouts', source.id);
    if (!existsSync(checkout)) return [];
    const actual = git(checkout, ['rev-parse', 'HEAD']).trim();
    if (actual !== source.pinnedCommit) throw new GauntletInvariantError(`Skill Depot checkout drifted for ${source.id}`);
    const discovered: DepotSkill[] = [];
    for (const base of [...source.include, ...source.optIn]) {
      const basePath = safeInside(checkout, base);
      if (!existsSync(basePath)) continue;
      for (const skillPath of findSkillDirs(basePath)) {
        const relativePath = relative(checkout, skillPath).split(sep).join('/');
        const text = readFileSync(join(skillPath, 'SKILL.md'), 'utf8');
        const name = frontmatter(text, 'name') || basename(skillPath);
        const description = frontmatter(text, 'description');
        discovered.push({
          sourceId: source.id,
          sourceCommit: source.pinnedCommit,
          name,
          description,
          relativePath,
          digest: digestTree(skillPath),
          optIn: source.optIn.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))
        });
      }
    }
    return discovered.sort((a, b) => a.name.localeCompare(b.name));
  }

  lock(runId: string, assignments: RoleSkillAssignment[]): SkillLockReceipt {
    if (!Array.isArray(assignments) || assignments.length > 200) {
      throw new GauntletInvariantError('a run may assign at most 200 skills');
    }
    const sources = this.listSources();
    const catalogs = new Map(sources.map((source) => [source.id, this.discover(source)]));
    const seen = new Set<string>();
    const entries: SkillLockEntry[] = assignments.map((assignment) => {
      const collisionKey = `${assignment.role}:${assignment.skillName}`;
      if (seen.has(collisionKey)) throw new GauntletInvariantError(`skill collision requires explicit precedence: ${collisionKey}`);
      seen.add(collisionKey);
      const skill = catalogs.get(assignment.sourceId)?.find((entry) => entry.name === assignment.skillName);
      if (!skill) throw new GauntletInvariantError(`unresolved skill: ${assignment.sourceId}/${assignment.skillName}`);
      return {
        sourceId: skill.sourceId,
        sourceCommit: skill.sourceCommit,
        skillName: skill.name,
        relativePath: skill.relativePath,
        digest: skill.digest,
        role: assignment.role
      };
    });
    return { runId, entries, createdAt: Date.now() };
  }

  materialize(lock: SkillLockReceipt, role: GauntletRole, destination: string): void {
    if (!isAbsolute(destination)) throw new GauntletInvariantError('skill destination must be absolute');
    mkdirSync(destination, { recursive: true });
    for (const entry of lock.entries.filter((candidate) => candidate.role === role)) {
      const sourceRoot = join(this.root, 'checkouts', entry.sourceId);
      const sourcePath = safeInside(sourceRoot, entry.relativePath);
      if (digestTree(sourcePath) !== entry.digest) throw new GauntletInvariantError(`skill changed after lock: ${entry.skillName}`);
      const target = join(destination, entry.skillName);
      if (existsSync(target)) throw new GauntletInvariantError(`skill target already exists: ${entry.skillName}`);
      cpSync(sourcePath, target, { recursive: true, dereference: false, errorOnExist: true });
      makeReadOnly(target);
    }
  }
}

function validateSource(input: SkillDepotSource, allowFile = false): SkillDepotSource {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id)) throw new GauntletInvariantError('invalid Skill Depot source id');
  if (!/^https:\/\/[^\s]+\.git$/.test(input.url) && !/^git@[^:]+:[^\s]+\.git$/.test(input.url)
      && !(allowFile && /^file:\/\/\/[^\s]+\.git$/.test(input.url))) {
    throw new GauntletInvariantError('Skill Depot source must be an HTTPS or SSH Git URL');
  }
  assertFullSha(input.pinnedCommit, 'Skill Depot pinnedCommit');
  return {
    id: input.id,
    url: input.url,
    pinnedCommit: input.pinnedCommit,
    enabled: Boolean(input.enabled),
    include: validateRelativePaths(input.include),
    optIn: validateRelativePaths(input.optIn)
  };
}

function validateRelativePaths(paths: string[]): string[] {
  if (!Array.isArray(paths) || paths.length > 100) throw new GauntletInvariantError('invalid Skill Depot path list');
  return paths.map((path) => {
    if (!path || isAbsolute(path) || path.split('/').includes('..')) throw new GauntletInvariantError(`unsafe Skill Depot path: ${path}`);
    return path.replace(/\\/g, '/').replace(/\/$/, '');
  });
}

function findSkillDirs(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new GauntletInvariantError(`symlink rejected in Skill Depot: ${path}`);
      if (entry.isDirectory()) visit(path);
      if (entry.isFile() && entry.name === 'SKILL.md') found.push(dir);
    }
  };
  visit(root);
  return [...new Set(found)];
}

function digestTree(root: string): string {
  const hash = createHash('sha256');
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      const rel = relative(root, path).split(sep).join('/');
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new GauntletInvariantError(`symlink rejected in skill: ${rel}`);
      hash.update(entry.isDirectory() ? `d:${rel}\0` : `f:${rel}\0`);
      if (entry.isDirectory()) visit(path);
      if (entry.isFile()) hash.update(readFileSync(path));
    }
  };
  visit(root);
  return hash.digest('hex');
}

function safeInside(root: string, rel: string): string {
  const target = resolve(root, rel);
  const diff = relative(resolve(root), target);
  if (!diff || diff.startsWith('..') || isAbsolute(diff)) throw new GauntletInvariantError('path escaped Skill Depot checkout');
  return target;
}

function makeReadOnly(root: string): void {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) throw new GauntletInvariantError('symlink rejected while materializing skill');
  if (stat.isDirectory()) {
    for (const entry of readdirSync(root)) makeReadOnly(join(root, entry));
    chmodSync(root, 0o555);
  } else {
    chmodSync(root, 0o444);
  }
}

function frontmatter(text: string, key: string): string {
  const header = text.startsWith('---\n') ? text.slice(4, text.indexOf('\n---', 4)) : '';
  return header.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm'))?.[1]?.trim() ?? '';
}

function normalizeGitUrl(url: string): string {
  return url.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '').toLowerCase();
}

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = error as { stderr?: Buffer | string; message?: string };
    throw new GauntletInvariantError(`Skill Depot git operation failed: ${String(detail.stderr ?? detail.message ?? error).trim()}`);
  }
}
