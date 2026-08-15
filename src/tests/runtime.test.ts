import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRuntimeOptions } from '../runtime.js';

test('parseRuntimeOptions parses named requester instance', () => {
  const options = parseRuntimeOptions(['setup', '--instance', 'wx-work', '--role', 'requester']);
  assert.deepEqual(options, { command: 'setup', instanceId: 'wx-work', role: 'requester' });
});

test('parseRuntimeOptions supports equals syntax', () => {
  const options = parseRuntimeOptions(['start', '--instance=admin.1', '--role=admin']);
  assert.deepEqual(options, { command: 'start', instanceId: 'admin.1', role: 'admin' });
});

test('parseRuntimeOptions rejects unsafe instance ids', () => {
  for (const instanceId of ['../escape', '.', '..', '-leading', 'x'.repeat(65)]) {
    assert.throws(
      () => parseRuntimeOptions(['start', '--instance', instanceId]),
      /Invalid instance id/,
    );
  }
});
