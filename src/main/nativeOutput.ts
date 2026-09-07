/** Native verbose output is transport, not durable evidence or run authority.
 * Bound each record and the whole session independently of retained diagnostics. */
export const NATIVE_OUTPUT_LIMITS = Object.freeze({ lineBytes: 1024 * 1024,
  sessionBytes: 64 * 1024 * 1024, previewBytes: 64 * 1024 });
export interface NativeOutputStats {
  receivedBytes: number; stdoutBytes: number; stderrBytes: number;
  stdoutPreviewTruncated: boolean; stderrPreviewTruncated: boolean;
}

export class NativeOutput {
  private readonly line = Buffer.alloc(NATIVE_OUTPUT_LIMITS.lineBytes);
  private readonly out = Buffer.alloc(NATIVE_OUTPUT_LIMITS.previewBytes);
  private readonly err = Buffer.alloc(NATIVE_OUTPUT_LIMITS.previewBytes);
  private used = 0;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private stopped = false;

  constructor(private readonly consume: (line: Buffer) => boolean, private readonly overflow: () => void) {}

  get pendingBytes(): number { return this.used; }
  get stats(): NativeOutputStats {
    return { receivedBytes: this.stdoutBytes + this.stderrBytes, stdoutBytes: this.stdoutBytes, stderrBytes: this.stderrBytes,
      stdoutPreviewTruncated: this.stdoutBytes > this.out.length, stderrPreviewTruncated: this.stderrBytes > this.err.length };
  }
  get stdoutPreview(): string { return this.out.subarray(0, Math.min(this.stdoutBytes, this.out.length)).toString('utf8'); }
  get stderrPreview(): string { return this.err.subarray(0, Math.min(this.stderrBytes, this.err.length)).toString('utf8'); }

  accept(which: 'stdout' | 'stderr', data: Buffer): void {
    if (this.stopped) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const previous = which === 'stdout' ? this.stdoutBytes : this.stderrBytes;
    const preview = which === 'stdout' ? this.out : this.err;
    if (which === 'stdout') this.stdoutBytes += chunk.length; else this.stderrBytes += chunk.length;
    if (previous < preview.length) chunk.copy(preview, previous, 0, Math.min(chunk.length, preview.length - previous));
    if (this.stdoutBytes + this.stderrBytes > NATIVE_OUTPUT_LIMITS.sessionBytes) {
      this.fail(); return;
    }
    if (which === 'stderr') return;
    // Fixed storage avoids repeatedly concatenating the growing stream or a
    // partially delivered record. Pipe chunk boundaries are not record bounds.
    let offset = 0;
    while (offset < chunk.length && !this.stopped) {
      const newline = chunk.indexOf(10, offset), end = newline < 0 ? chunk.length : newline;
      const length = end - offset;
      if (this.used + length > this.line.length) { this.fail(); return; }
      chunk.copy(this.line, this.used, offset, end); this.used += length;
      if (newline < 0) return;
      if (this.used && !this.consume(this.line.subarray(0, this.used))) this.stopped = true;
      this.used = 0; offset = newline + 1;
    }
  }

  /** Fresh workers accept one final record without a terminating newline. */
  flush(): void {
    if (!this.stopped && this.used) {
      if (!this.consume(this.line.subarray(0, this.used))) this.stopped = true;
      this.used = 0;
    }
  }
  private fail(): void { this.stopped = true; this.overflow(); }
}
