import type { ToolActivity } from '../shared/gauntlet';

/** Deliberately projects only a closed activity vocabulary. No tool inputs,
 * paths, commands, output, model prose or provider-supplied IDs leave here. */
export function claudeActivity(sessionId: string, emit: (event: ToolActivity) => void) {
  const started = new Map<string, ToolActivity['activity']>(), finished = new Set<string>();
  let ordinal = 0;
  return (event: unknown): void => {
    if (!event || typeof event !== 'object') return;
    const message = event as { session_id?: unknown; type?: unknown; message?: {content?: unknown} };
    if (message.session_id !== sessionId || !['assistant','user'].includes(String(message.type))) return;
    const content = message.message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (message.type === 'assistant' && block.type === 'tool_use') {
        if (typeof block.id !== 'string' || block.id.length > 256 || !block.id || started.has(block.id)) continue;
        if (started.size >= 1024) throw Error('Activity observation limit exceeded');
        const activity: ToolActivity['activity'] = block.name === 'Read' ? 'reading' : ['Glob','Grep'].includes(block.name) ? 'searching' :
          ['Write','Edit'].includes(block.name) ? 'editing' : block.name === 'Bash' ? 'executing' : 'tool';
        started.set(block.id, activity);
        emit({type:'tool_activity',ordinal:++ordinal,activity,stage:'requested'});
      } else if (message.type === 'user' && block.type === 'tool_result' && started.has(block.tool_use_id) && !finished.has(block.tool_use_id)) {
        finished.add(block.tool_use_id);
        emit({type:'tool_activity',ordinal:++ordinal,activity:started.get(block.tool_use_id)!,stage:'result',outcome:block.is_error === true ? 'error' : 'ok'});
      }
    }
  };
}
