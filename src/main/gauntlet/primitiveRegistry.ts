import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { EnforcementLevel, PrimitiveReceipt } from '../../shared/gauntlet';
import { GauntletInvariantError } from './core';

export type PrimitiveKind = 'reviewer' | 'transformer' | 'author' | 'investigator' | 'planner';

export interface ResolvedPrimitive {
  id: string;
  kind: PrimitiveKind;
  surface: 'agent';
  bundle: string;
  prompt: string;
  readOnly: boolean;
  cleanContext: boolean;
  sourceCommit: string;
  digest: string;
}

export const PINNED_AGENT_PRIMITIVES_COMMIT = '7c0ceb64d0ffb8c7b4c8548b6fdd09e4ee9a17c0';

export class PrimitiveRegistry {
  constructor(
    private readonly sourceRoot: string,
    private readonly expectedCommit: string | null = PINNED_AGENT_PRIMITIVES_COMMIT
  ) {}

  resolve(id: string): ResolvedPrimitive {
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) throw new GauntletInvariantError(`invalid primitive id: ${id}`);
    const root = resolve(this.sourceRoot);
    const primitiveDir = join(root, 'primitives', 'agents', id);
    const promptPath = join(primitiveDir, 'agent.md');
    const metaPath = join(primitiveDir, 'meta.yaml');
    if (!existsSync(promptPath) || !existsSync(metaPath)) throw new GauntletInvariantError(`primitive not found: ${id}`);
    const prompt = readFileSync(promptPath, 'utf8');
    const meta = readFileSync(metaPath, 'utf8');
    const name = scalar(meta, 'name');
    const kind = scalar(meta, 'kind') as PrimitiveKind;
    const surface = scalar(meta, 'surface');
    const bundle = scalar(meta, 'bundle');
    if (name !== id || !['reviewer', 'transformer', 'author', 'investigator', 'planner'].includes(kind)) {
      throw new GauntletInvariantError(`invalid primitive metadata: ${id}`);
    }
    if (surface !== 'agent') throw new GauntletInvariantError(`unsupported primitive surface: ${surface}`);
    const readOnly = /^\s*read_only:\s*true\b/m.test(meta);
    const cleanContext = /^\s*clean_context:\s*true\b/m.test(meta);
    if (kind === 'reviewer' && (!readOnly || !cleanContext)) {
      throw new GauntletInvariantError(`reviewer ${id} must require read_only and clean_context`);
    }
    const detectedCommit = maybeGit(root, ['rev-parse', 'HEAD'])?.trim();
    if (this.expectedCommit && detectedCommit && detectedCommit !== this.expectedCommit) {
      throw new GauntletInvariantError(`primitive source drift: expected ${this.expectedCommit}, got ${detectedCommit}`);
    }
    if (!this.expectedCommit && !detectedCommit) {
      throw new GauntletInvariantError('local primitive override must be a Git checkout with an exact HEAD commit');
    }
    // Packaged extraResources contain the pinned tree without the parent's Git
    // object database. The committed submodule pin remains the lock authority.
    const sourceCommit = detectedCommit ?? this.expectedCommit!;
    const digest = createHash('sha256').update(meta).update('\0').update(prompt).digest('hex');
    return { id, kind, surface: 'agent', bundle, prompt, readOnly, cleanContext, sourceCommit, digest };
  }

  resolveGeneralEngineeringCritic(provider: 'claude' | 'codex'): { prompt: string; receipts: PrimitiveReceipt[] } {
    const primitives = ['verification-critic', 'architecture-reviewer'].map((id) => this.resolve(id));
    const enforcement: EnforcementLevel = provider === 'codex' ? 'enforced' : 'partial';
    const prompt = [
      '# Atelier General Engineering Critic',
      '',
      'You are a fresh, independent, read-only critic. You did not implement this artifact.',
      'Evaluate the exact commit and frozen bar supplied by Atelier. Inspect the real diff, tests, logs, and application evidence.',
      'Cover functional correctness, edge cases, regression risk, repository conventions, maintainability, and simpler/safer alternatives.',
      'Do not edit, commit, repair, expand the frozen bar, or accept an implementer-authored success narrative.',
      'Return Atelier structured JSON only; the Conductor, not you, is final authority.',
      '',
      ...primitives.flatMap((primitive) => [
        `## Typed primitive: ${primitive.id}`,
        primitive.prompt,
        ''
      ])
    ].join('\n');
    return {
      prompt,
      receipts: primitives.map((primitive) => ({
        primitiveId: primitive.id,
        sourceCommit: primitive.sourceCommit,
        digest: primitive.digest,
        enforcement
      }))
    };
  }
}

function scalar(yaml: string, key: string): string {
  return yaml.match(new RegExp(`^${key}:\\s*([^#\\n]+)`, 'm'))?.[1]?.trim() ?? '';
}

function maybeGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { return null; }
}
