const MAX_FRAME = 1024 * 1024, MAX_RESPONSE = 16 * 1024 * 1024;

/** Protocol validation, not a verdict about the artifact or model's claims. */
export function codexResponseEvent(bytes: Uint8Array): { type: string; terminal: boolean } {
  if (bytes.byteLength > MAX_FRAME) throw Error('provider event too large');
  const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
    typeof event.type !== 'string' || !/^[a-z][a-z0-9_.]{0,127}$/.test(event.type)) throw Error('invalid provider event');
  if (event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete' ||
    event.error != null || event.response?.error != null) throw Error('provider did not complete');
  const terminal = event.type === 'response.completed';
  if (terminal && (!event.response || event.response.status !== 'completed' ||
    typeof event.response.id !== 'string' || !event.response.id || event.response.id.length > 512)) {
    throw Error('invalid provider completion');
  }
  return { type: event.type, terminal };
}

/** Parse bounded SSE records before exposing their data. Never relay comments,
 * retry hints or raw error records. Hold completion until the stream has ended
 * cleanly so trailing malformed/error data cannot follow an accepted terminal.
 * Both network chunks and UTF-8 characters may cross record boundaries.
 */
export async function* codexResponseSse(source: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
  let pending = Buffer.alloc(0), received = 0, recordBytes = 0;
  let data: string[] = [], eventName: string | undefined, completion: Buffer | undefined, done = false;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  function record(): Buffer | undefined {
    const fields = data; data = []; recordBytes = 0;
    const name = eventName; eventName = undefined;
    if (!fields.length) return;
    const text = fields.join('\n');
    if (text === '[DONE]') {
      if (!completion || done) throw Error('premature or duplicate stream end');
      done = true; return;
    }
    if (completion) throw Error('event after completion');
    const bytes = Buffer.from(text), event = codexResponseEvent(bytes);
    if (name !== undefined && name !== event.type) throw Error('mismatched provider event');
    // Canonical single-line JSON prevents data lines from becoming SSE fields.
    const frame = Buffer.from(`event: ${event.type}\ndata: ${JSON.stringify(JSON.parse(text))}\n\n`);
    if (event.terminal) { completion = frame; return; }
    return frame;
  }
  for await (const chunk of source) {
    received += chunk.byteLength;
    if (received > MAX_RESPONSE) throw Error('provider stream too large');
    pending = Buffer.concat([pending, chunk]);
    let start = 0, end: number;
    while ((end = pending.indexOf(10, start)) !== -1) {
      let lineBytes = pending.subarray(start, end); start = end + 1;
      recordBytes += lineBytes.length + 1;
      if (recordBytes > MAX_FRAME) throw Error('provider record too large');
      if (lineBytes.at(-1) === 13) lineBytes = lineBytes.subarray(0, -1);
      const line = decoder.decode(lineBytes);
      if (!line) { const frame = record(); if (frame) yield frame; continue; }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') {
        if (eventName !== undefined) throw Error('duplicate event name');
        eventName = value;
      }
      // Other SSE fields have no authority and are not forwarded.
    }
    pending = Buffer.from(pending.subarray(start));
    if (recordBytes + pending.length > MAX_FRAME) throw Error('provider record too large');
  }
  if (pending.length || recordBytes || !completion) throw Error('incomplete provider stream');
  yield completion;
}
