import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { withFileLock } from '../file-lock.js';

test('file lock records its owner and cleans up after completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wcc-lock-'));
  const lockPath = join(root, 'nested', 'test.lock');
  try {
    const result = withFileLock(lockPath, 'busy', () => {
      assert.equal(readFileSync(lockPath, 'utf8').trim(), String(process.pid));
      return 42;
    });
    assert.equal(result, 42);
    assert.throws(() => readFileSync(lockPath, 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('file lock recovers a lock owned by a dead process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wcc-lock-'));
  const lockPath = join(root, 'test.lock');
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(lockPath, '2147483647\n', 'utf8');
    assert.equal(withFileLock(lockPath, 'busy', () => 'recovered'), 'recovered');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
