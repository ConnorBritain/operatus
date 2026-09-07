import type { AgentLaunch, RuntimeEvent, RuntimeObservation } from '@shared/gauntlet';
import { runtimeEventNeedsAttention } from '@shared/gauntletRuntime';

/** Conductor authority stays registered independently of its process lifetime. */
export function protocolLaunchLabel(launch: Pick<AgentLaunch, 'role' | 'status'>): string {
  return launch.role === 'conductor' && launch.status === 'created' ? 'Authority registered' : launch.status;
}

/** Suggested inspection, never a retry/resume command or an inferred cause. */
function exitGuidance(event: Extract<RuntimeEvent, {type:'process_exited'}>): string | null {
  if (!event.processExited || event.gatewayRevocation !== 'confirmed') return 'Inspect the unconfirmed shutdown and its capacity reservation before starting replacement work. Do not infer that the recorded PID is still owned.';
  switch (event.reason) {
    case 'output_limit': return 'Inspect the last observed activity and output counters. A stream limit ended this session; output volume is not task progress. Do not increase limits blindly.';
    case 'timeout': return 'Inspect the current artifact, checks and last observed activity before deciding whether the objective needs a smaller scope or a new run budget.';
    case 'provider_error': return 'Check the selected provider and subscription diagnostics. The transport reported a provider error; this record does not establish whether authentication, allowance or another provider failure caused it. No API fallback is available.';
    case 'spawn_error': return 'Inspect the pinned executable, local runtime preparation and subscription diagnostics before starting new work.';
    case 'invalid_result': case 'invalid_stream': return 'Inspect protocol and session identity evidence. The native response was not accepted; do not treat terminal prose as completion.';
    case 'unexpected_exit': return 'Inspect the interrupted session and preserved work. A new run must not silently resume this process identity.';
    default: return null;
  }
}

/** These are recorded observations, never a live PID lookup or resume token. */
export function runtimeView(launchId: string, observations: RuntimeObservation[] = []) {
  const own = observations.filter(item => item.launchId === launchId);
  const started = own.find(item => item.event.type === 'process_started');
  const exited = own.find(item => item.event.type === 'process_exited');
  const recovered = own.find(item => item.event.type === 'recovery_interrupted');
  const admissionRow = own.find(item => item.event.type === 'subscription_admission');
  const admission = admissionRow?.event.type === 'subscription_admission' ? admissionRow.event : null;
  const output = exited?.event.type === 'process_exited' ? exited.event.output ?? null : null;
  const identityRows = own.filter(item => item.event.type === 'native_identity');
  const identityRow = identityRows.find(item => item.event.type === 'native_identity' && item.event.turnId !== null) ?? identityRows[0];
  const nativeIdentity = identityRow?.event.type === 'native_identity' ? identityRow.event : null;
  let guidance: string | null = null;
  let label = 'Not observed starting', detail = 'Preparation is not proof of a running process.', warning = false;
  if (started?.event.type === 'process_started') {
    label = 'Started; exit not yet observed';
    detail = `Observed PID ${started.event.pid} · ${started.event.model}. This is not a live health check.`;
  }
  if (recovered) {
    label = 'Exit unknown after restart'; warning = true;
    detail = 'The previous process exit was not observed. Its PID must not be used to resume or terminate a process.';
    guidance = 'Inspect preserved work and the interrupted capacity reservation. Recovery is not permission to reuse the old session or PID.';
  }
  if (exited?.event.type === 'process_exited') {
    const event = exited.event;
    label = event.processExited ? `Exited${event.exitCode === null ? '' : ` · code ${event.exitCode}`}` : 'Process exit unconfirmed';
    detail = `${event.reason.replaceAll('_', ' ')} · gateway ${event.gatewayRevocation === 'confirmed' ? 'revoked' : 'revocation unconfirmed'}. Descendant quiescence is not verified.`;
    warning = runtimeEventNeedsAttention(event);
    guidance = exitGuidance(event);
  }
  const deliveries = own.filter(item => item.event.type === 'delivery_queued').map(item => {
    const event = item.event;
    if (event.type !== 'delivery_queued') throw Error('Unexpected delivery projection');
    const completion = own.find(other => other.event.type === 'delivery_completed' && other.event.messageId === event.messageId);
    return { messageId: event.messageId, purpose: event.purpose, at: item.at, reportId: event.reportId,
      promptSha256: event.promptSha256, status: completion?.event.type === 'delivery_completed'
        ? completion.event.ok ? 'Turn completed' : 'Turn failed' : 'No result observed' };
  });
  const activities = own.filter(item => item.event.type === 'tool_activity').map(item => {
    const event = item.event;
    if (event.type !== 'tool_activity') throw Error('Unexpected activity projection');
    return { at:item.at, ordinal:event.ordinal, activity:event.activity, stage:event.stage, outcome:event.outcome };
  });
  return { label, detail, warning, deliveries, activities, admission, output, guidance, nativeIdentity };
}
