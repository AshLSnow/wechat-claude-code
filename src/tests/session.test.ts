import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSessionStore } from '../session.js';

test('new sessions inherit the instance working directory', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'wcc-session-'));
  const workingDirectory = join(dataDirectory, 'shared-repo');
  try {
    const store = createSessionStore(workingDirectory, dataDirectory);
    const session = store.load('account@example.com');
    assert.equal(session.workingDirectory, workingDirectory);

    const cleared = store.clear('account@example.com');
    assert.equal(cleared.workingDirectory, workingDirectory);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
