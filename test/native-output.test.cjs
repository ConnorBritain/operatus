'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { NativeOutput, NATIVE_OUTPUT_LIMITS: limits } = require('./load-ts.cjs')('src/main/nativeOutput.ts');
test('long valid streams exceed the old aggregate cap without retaining the transcript', () => {
  let lines = 0, overflow = 0;
  const stream = new NativeOutput(line => { assert.equal(JSON.parse(line).type, 'assistant'); lines++; return true; }, () => overflow++);
  const line = Buffer.from(JSON.stringify({ type: 'assistant', text: 'x'.repeat(32 * 1024) }) + '\n');
  for (let i = 0; i < 600; i++) stream.accept('stdout', line);
  assert.equal(lines, 600); assert.equal(overflow, 0); assert.ok(stream.stats.receivedBytes > 16 * 1024 * 1024);
  assert.equal(stream.pendingBytes, 0); assert.equal(Buffer.byteLength(stream.stdoutPreview), limits.previewBytes);
  assert.equal(stream.stats.stdoutPreviewTruncated, true);
});
test('record boundaries survive UTF-8 byte splits and multiple records per pipe chunk', () => {
  const records = [], stream = new NativeOutput(line => { records.push(JSON.parse(line)); return true; }, () => assert.fail('overflow'));
  const data = Buffer.from('{"text":"café ☕"}\n{"type":"result"}\n');
  for (const byte of data) stream.accept('stdout', Buffer.from([byte]));
  stream.accept('stdout', Buffer.from('{}\n{}\n'));
  assert.deepEqual(records, [{ text: 'café ☕' }, { type: 'result' }, {}, {}]);
  assert.equal(stream.pendingBytes, 0);
});
test('exact per-record bound accepts its newline but a larger unterminated record fails once', () => {
  let length, overflow = 0;
  const stream = new NativeOutput(line => { length = line.length; return true; }, () => overflow++);
  stream.accept('stdout', Buffer.alloc(limits.lineBytes, 120)); assert.equal(stream.pendingBytes, limits.lineBytes);
  stream.accept('stdout', Buffer.from('\n')); assert.equal(length, limits.lineBytes);
  stream.accept('stdout', Buffer.alloc(limits.lineBytes, 120)); stream.accept('stdout', Buffer.from('x'));
  stream.accept('stdout', Buffer.from('\n')); stream.flush(); assert.equal(overflow, 1);
  assert.ok(stream.pendingBytes <= limits.lineBytes);
});
test('combined stdout/stderr session limit rejects further parsing while retaining bounded previews', () => {
  let lines = 0, overflow = 0;
  const stream = new NativeOutput(() => { lines++; return true; }, () => overflow++);
  const chunk = Buffer.alloc(limits.lineBytes, 120);
  for (let i = 0; i < limits.sessionBytes / chunk.length; i++) stream.accept('stderr', chunk);
  assert.equal(overflow, 0); stream.accept('stdout', Buffer.from('{}\n')); stream.accept('stdout', Buffer.from('{}\n'));
  assert.equal(overflow, 1); assert.equal(lines, 0);
  assert.equal(Buffer.byteLength(stream.stderrPreview), limits.previewBytes);
  assert.equal(stream.stats.stderrPreviewTruncated, true);
  assert.equal(stream.stats.receivedBytes, limits.sessionBytes + 3);
});
test('consumer refusal prevents later records and fresh EOF flushing delivers only one pending record', () => {
  const seen = [], stream = new NativeOutput(line => { seen.push(line.toString()); return false; }, () => assert.fail('overflow'));
  stream.accept('stdout', Buffer.from('bad\n{}\n')); stream.flush(); assert.deepEqual(seen, ['bad']);
  const flushed = [], fresh = new NativeOutput(line => { flushed.push(line.toString()); return true; }, () => assert.fail('overflow'));
  fresh.accept('stdout', Buffer.from('{"type":"result"}')); fresh.flush(); fresh.flush();
  assert.deepEqual(flushed, ['{"type":"result"}']); assert.equal(fresh.pendingBytes, 0);
});
