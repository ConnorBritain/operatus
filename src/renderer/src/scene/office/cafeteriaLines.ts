// Ambient operations-floor chatter. These lines are deliberately role-neutral:
// the internal cast keys remain a stable sprite API, not character identities.

import type { OfficeCharacterName } from './cast';

/** Where an agent is lingering — picks a contextual line pool. */
export type BreakSpot = 'coffee' | 'vending' | 'snack' | 'table';

type Exchange = readonly string[];

const pick = <T,>(values: readonly T[], seed: number): T =>
  values[((seed % values.length) + values.length) % values.length];

const SPOT_LINES: Record<BreakSpot, readonly string[]> = {
  coffee: [
    'fresh coffee, fresh context',
    'one more cup, then the diff',
    'the quiet corner is working',
    'saving this thought before I forget',
    'the build can steep for a minute'
  ],
  vending: [
    'evidence first, snack second',
    'small break, bounded scope',
    'the machine accepted exact change',
    'one reproducible snack, please',
    'fuel for one more check'
  ],
  snack: [
    'this is part of the method',
    'tiny pause, clearer judgment',
    'the fruit bowl has excellent uptime',
    'sharing the last biscuit',
    'back to the artifact in a minute'
  ],
  table: [
    'what would falsify this?',
    'the bar is still the bar',
    'let’s keep the interface small',
    'I left notes with the evidence',
    'fresh eyes after this break'
  ]
};

const EXCHANGES: readonly Exchange[] = [
  ['what changed?', 'one exact commit.', 'good. what proves it?'],
  ['is the bar frozen?', 'digest matches.', 'then we can begin.'],
  ['how did the check go?', 'green, with receipts.', 'music to my ears.'],
  ['fresh context?', 'completely fresh.', 'ask the uncomfortable question.'],
  ['I found a strange edge case.', 'material?', 'I’m gathering evidence.'],
  ['the diff is smaller now.', 'and clearer?', 'much clearer.'],
  ['should we add an abstraction?', 'does the boundary need one?', 'not yet.'],
  ['what are you working from?', 'the exact artifact.', 'perfect.'],
  ['the first idea failed.', 'usefully?', 'we know what not to repeat.'],
  ['quiet in here today.', 'everyone is reading.', 'the good kind of quiet.'],
  ['did you check the failure path?', 'twice.', 'once more with fresh eyes.'],
  ['coffee?', 'after this assertion.', 'bounded caffeine.'],
  ['I think it passes.', 'think or demonstrated?', 'demonstrated.'],
  ['any scope drift?', 'none observed.', 'put that in the receipt.'],
  ['the critic was right.', 'good catch?', 'very good catch.'],
  ['what happens next?', 'repair, then re-critique.', 'new session?'],
  ['new session.', 'new artifact?', 'new artifact.'],
  ['can we ship it?', 'the Conductor decides.', 'with evidence.'],
  ['the test is oddly specific.', 'the bug was oddly specific.', 'fair point.'],
  ['I like this room.', 'warm light, sharp reviews.', 'ideal conditions.']
];

/** A deterministic solo line for a break spot. The character parameter is kept
 * for compatibility with the existing floor director, but does not select a
 * branded persona. */
export function pickSoloLine(_character: OfficeCharacterName, spot: BreakSpot, seed: number): string {
  return pick(SPOT_LINES[spot], seed);
}

/** A deterministic multi-beat exchange. Beats alternate between table-mates. */
export function pickExchange(_speaker: OfficeCharacterName, seed: number): Exchange {
  return pick(EXCHANGES, seed);
}
