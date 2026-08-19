import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildClaudeArgs,
  handleStreamLine,
  resolveClaudeExecutable,
  type StreamParserState,
} from '../claude/provider.js';

function freshState(): StreamParserState {
  return { sessionId: '', textParts: [], trackingSkill: false, skillInputAccum: '' };
}

test('handleStreamLine: system init 设置 sessionId', () => {
  const state = freshState();
  handleStreamLine(
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-123' }),
    state,
    {},
  );
  assert.equal(state.sessionId, 'sess-123');
});

test('handleStreamLine: text_delta 触发 onText', () => {
  const calls: string[] = [];
  handleStreamLine(
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
    }),
    freshState(),
    { onText: (t) => calls.push(t) },
  );
  assert.deepEqual(calls, ['hello']);
});

test('handleStreamLine: content_block_stop 重置 trackingSkill，无回调', () => {
  const state = freshState();
  state.trackingSkill = true;
  let textCalls = 0;
  let turnEndCalls = 0;
  handleStreamLine(
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }),
    state,
    { onText: () => textCalls++, onTurnEnd: () => turnEndCalls++ },
  );
  assert.equal(state.trackingSkill, false);
  assert.equal(textCalls, 0);
  assert.equal(turnEndCalls, 0);
});

test('handleStreamLine: assistant 消息文本累积到 textParts', () => {
  const state = freshState();
  handleStreamLine(
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '回复内容' }] },
    }),
    state,
    {},
  );
  assert.deepEqual(state.textParts, ['回复内容']);
});

test('handleStreamLine: 空行和非法 JSON 静默跳过', () => {
  const state = freshState();
  handleStreamLine('', state, {});
  handleStreamLine('not json', state, {});
  handleStreamLine('   ', state, {});
  assert.deepEqual(state.textParts, []);
});

test('handleStreamLine: message_delta 带 stop_reason 触发 onTurnEnd', () => {
  const calls: string[] = [];
  handleStreamLine(
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    }),
    freshState(),
    { onTurnEnd: (r) => calls.push(r) },
  );
  assert.deepEqual(calls, ['end_turn']);
});

test('handleStreamLine: message_delta 无 stop_reason 不触发 onTurnEnd', () => {
  const calls: string[] = [];
  handleStreamLine(
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_delta', delta: {} },
    }),
    freshState(),
    { onTurnEnd: (r) => calls.push(r) },
  );
  assert.deepEqual(calls, []);
});

test('handleStreamLine: tool_use stop_reason 也正常透传', () => {
  const calls: string[] = [];
  handleStreamLine(
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    }),
    freshState(),
    { onTurnEnd: (r) => calls.push(r) },
  );
  assert.deepEqual(calls, ['tool_use']);
});

test('buildClaudeArgs: admin instance keeps full permission mode', () => {
  const args = buildClaudeArgs({ permission: 'admin' });
  assert.ok(args.includes('--dangerously-skip-permissions'));
  assert.ok(!args.includes('--safe-mode'));
});

test('buildClaudeArgs: requester instance is restricted to read tools and plan mode', () => {
  const args = buildClaudeArgs({ permission: 'read-only' });
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.ok(args.includes('--safe-mode'));
  assert.deepEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), [
    '--permission-mode',
    'plan',
  ]);
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), [
    '--tools',
    'Read,Grep,Glob',
  ]);
});

test('resolveClaudeExecutable finds the native executable behind the Windows npm shim', () => {
  const root = mkdtempSync(join(tmpdir(), 'wcc-claude-bin-'));
  try {
    const executable = join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    mkdirSync(resolve(executable, '..'), { recursive: true });
    writeFileSync(executable, '');
    assert.equal(resolveClaudeExecutable({ PATH: root }, 'win32'), executable);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveClaudeExecutable honors an explicit executable path', () => {
  assert.equal(
    resolveClaudeExecutable({ WCC_CLAUDE_PATH: './custom-claude.exe' }, 'win32'),
    resolve('./custom-claude.exe'),
  );
});
