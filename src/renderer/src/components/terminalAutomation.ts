/** Slash commands that open an interactive picker/panel instead of starting a
 * normal agent turn. Automated queue delivery must wait until that UI closes. */
const INTERACTIVE_COMMANDS = new Set([
  '/model',
  '/reasoning',
  '/permissions',
  '/permission',
  '/provider',
  '/settings',
  '/config',
  '/experimental',
  '/experiments',
  '/hooks',
  '/mcp',
  '/apps',
  '/plugins',
  '/resume',
  '/sessions'
]);

export function opensInteractiveTerminalUi(input: string): boolean {
  // Only a BARE command opens a picker. `/model` prompts you to choose;
  // `/model sonnet` applies the argument and returns to the prompt with no UI
  // to close. Matching on the first token alone latched the block on the second
  // form too, and nothing could ever clear it — the agent's message queue then
  // silently stopped delivering for the rest of the session.
  const trimmed = input.trim().toLowerCase();
  if (/\s/.test(trimmed)) return false;
  return INTERACTIVE_COMMANDS.has(trimmed);
}

/** Follow output only if the user was already at (or one line from) the bottom.
 * This keeps live TUIs visible without yanking someone reading scrollback. */
export function shouldFollowTerminalOutput(viewportY: number, baseY: number): boolean {
  return baseY - viewportY <= 1;
}

export interface TerminalAutomationState {
  exited: boolean;
  pickerOpen: boolean;
  inputDirty: boolean;
  settleUntil: number;
  recoveryPending?: boolean;
  inputDirtyAt?: number; // diagnostic only; elapsed time never grants input ownership
  pickerOpenedAt?: number; // diagnostic only
}

/** Why automation may not own the prompt right now, or null when it may. */
export type TerminalAutomationBlock = 'exited' | 'recovering' | 'picker' | 'draft' | 'settling' | null;

export function terminalAutomationBlock(
  state: TerminalAutomationState,
  now = Date.now()
): TerminalAutomationBlock {
  if (state.exited) return 'exited';
  if (state.recoveryPending) return 'recovering';
  // Silence, sleep and a hidden window do not transfer the user's prompt to
  // automation. Only observed input/recovery actions clear these ownership flags.
  if (state.pickerOpen) return 'picker';
  if (state.inputDirty) return 'draft';
  if (now < state.settleUntil) return 'settling';
  return null;
}

/** Automatic writes may own the prompt only when no user draft or picker does. */
export function canAutomateTerminal(
  state: TerminalAutomationState,
  now = Date.now()
): boolean {
  return terminalAutomationBlock(state, now) === null;
}
