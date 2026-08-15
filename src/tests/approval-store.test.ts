import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitApprovalStore } from '../governance/approval-store.js';

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'git failed');
  return result.stdout.trim();
}

function createRepository(root: string): string {
  const repository = join(root, 'target');
  git(root, ['init', '-b', 'main', repository]);
  writeFileSync(join(repository, 'app.txt'), 'before\n', 'utf8');
  git(repository, ['add', 'app.txt']);
  git(repository, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial']);
  return repository;
}

test('GitApprovalStore records, executes, commits, and fast-forwards an approved request', () => {
  const root = mkdtempSync(join(tmpdir(), 'wcc-approval-'));
  try {
    const repository = createRepository(root);
    const store = new GitApprovalStore(join(root, 'data'));
    const request = store.submit({
      requesterInstanceId: 'worker-1',
      requesterAccountId: 'wx-worker',
      workingDirectory: repository,
      prompt: 'change app.txt',
    });

    assert.equal(request.status, 'pending');
    assert.equal(store.list('pending').length, 1);
    assert.ok(git(store.ledgerDir, ['log', '-1', '--format=%s']).startsWith('request '));

    const execution = store.prepareApproval(request.id, 'admin');
    writeFileSync(join(execution.cwd, 'app.txt'), 'after\n', 'utf8');
    const finalized = store.finalizeApproval(request.id);

    assert.equal(finalized.request.status, 'completed');
    assert.equal(readFileSync(join(repository, 'app.txt'), 'utf8').replace(/\r\n/g, '\n'), 'after\n');
    assert.equal(git(repository, ['status', '--porcelain']), '');
    assert.equal(git(repository, ['rev-parse', 'HEAD']), finalized.request.resultCommit);
    assert.match(git(repository, ['log', '-1', '--format=%s']), /^wcc: apply request /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitApprovalStore refuses approval when target repository is dirty', () => {
  const root = mkdtempSync(join(tmpdir(), 'wcc-approval-dirty-'));
  try {
    const repository = createRepository(root);
    const store = new GitApprovalStore(join(root, 'data'));
    const request = store.submit({
      requesterInstanceId: 'worker-1',
      requesterAccountId: 'wx-worker',
      workingDirectory: repository,
      prompt: 'change app.txt',
    });
    writeFileSync(join(repository, 'app.txt'), 'dirty\n', 'utf8');
    assert.throws(() => store.prepareApproval(request.id, 'admin'), /uncommitted changes/);
    assert.equal(store.get(request.id).status, 'pending');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitApprovalStore records rejection in the Git ledger', () => {
  const root = mkdtempSync(join(tmpdir(), 'wcc-approval-reject-'));
  try {
    const repository = createRepository(root);
    const store = new GitApprovalStore(join(root, 'data'));
    const request = store.submit({
      requesterInstanceId: 'worker-1',
      requesterAccountId: 'wx-worker',
      workingDirectory: repository,
      prompt: 'change app.txt',
    });
    const rejected = store.reject(request.id, 'admin', 'not needed');
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectionReason, 'not needed');
    assert.equal(git(store.ledgerDir, ['log', '-1', '--format=%s']), `reject ${request.id}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitApprovalStore commits direct admin changes for audit', () => {
  const root = mkdtempSync(join(tmpdir(), 'wcc-admin-audit-'));
  try {
    const repository = createRepository(root);
    const store = new GitApprovalStore(join(root, 'data'));
    const context = store.prepareAdminAudit(repository, 'admin', 'update app text');
    writeFileSync(join(repository, 'app.txt'), 'admin change\n', 'utf8');
    const result = store.finalizeAdminAudit(context);

    assert.ok(result.commit);
    assert.match(result.message ?? '', /Git 提交/);
    assert.equal(git(repository, ['status', '--porcelain']), '');
    assert.match(git(repository, ['log', '-1', '--format=%s']), /^wcc: admin task by admin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitApprovalStore marks a failed approval with no changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'wcc-approval-failed-'));
  try {
    const repository = createRepository(root);
    const store = new GitApprovalStore(join(root, 'data'));
    const request = store.submit({
      requesterInstanceId: 'worker-1',
      requesterAccountId: 'wx-worker',
      workingDirectory: repository,
      prompt: 'change app.txt',
    });
    store.prepareApproval(request.id, 'admin');
    const finalized = store.finalizeApproval(request.id, 'Claude process failed');
    assert.equal(finalized.request.status, 'failed');
    assert.match(finalized.message, /failed without file changes/);
    assert.equal(git(repository, ['log', '-1', '--format=%s']), 'initial');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitApprovalStore keeps an approved commit on its proposal branch when target moved', () => {
  const root = mkdtempSync(join(tmpdir(), 'wcc-approval-moved-'));
  try {
    const repository = createRepository(root);
    const store = new GitApprovalStore(join(root, 'data'));
    const request = store.submit({
      requesterInstanceId: 'worker-1',
      requesterAccountId: 'wx-worker',
      workingDirectory: repository,
      prompt: 'change app.txt',
    });
    const execution = store.prepareApproval(request.id, 'admin');
    writeFileSync(join(execution.cwd, 'app.txt'), 'proposal\n', 'utf8');

    writeFileSync(join(repository, 'other.txt'), 'concurrent\n', 'utf8');
    git(repository, ['add', 'other.txt']);
    git(repository, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'concurrent']);

    const finalized = store.finalizeApproval(request.id);
    assert.equal(finalized.request.status, 'ready');
    assert.equal(readFileSync(join(repository, 'app.txt'), 'utf8').replace(/\r\n/g, '\n'), 'before\n');
    assert.equal(git(repository, ['rev-parse', finalized.request.proposalBranch!]), finalized.request.resultCommit);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
