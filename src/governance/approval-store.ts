import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { BASE_DATA_DIR } from '../constants.js';
import { withFileLock } from '../file-lock.js';

export type ChangeRequestStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'ready'
  | 'rejected'
  | 'failed'
  | 'no_changes';

export interface ChangeRequest {
  id: string;
  status: ChangeRequestStatus;
  requesterInstanceId: string;
  requesterAccountId: string;
  targetRepo: string;
  targetCwd: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  reviewerInstanceId?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  baseHead?: string;
  targetBranch?: string;
  proposalBranch?: string;
  worktreePath?: string;
  resultCommit?: string;
  error?: string;
}

export interface ApprovalExecution {
  request: ChangeRequest;
  cwd: string;
  prompt: string;
}

export interface ApprovalFinalization {
  request: ChangeRequest;
  message: string;
}

export interface AdminAuditContext {
  instanceId: string;
  targetRepo: string;
  baseHead: string;
  targetBranch: string;
  prompt: string;
}

export interface AdminAuditFinalization {
  commit?: string;
  message?: string;
}

interface GitResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runGit(cwd: string, args: string[], allowFailure = false): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  const status = result.status ?? 1;
  const output = {
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    status,
  };
  if (!allowFailure && (result.error || status !== 0)) {
    throw new Error(output.stderr || output.stdout || result.error?.message || `git exited with ${status}`);
  }
  return output;
}

function sanitizeSubject(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim().slice(0, 72) || 'approved change';
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function resolveGitRoot(path: string): string {
  const absolute = resolve(path);
  const result = runGit(absolute, ['rev-parse', '--show-toplevel'], true);
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`Change requests require a Git repository: ${absolute}`);
  }
  return resolve(result.stdout);
}

export class GitApprovalStore {
  readonly ledgerDir: string;
  readonly worktreesDir: string;
  private readonly lockPath: string;

  constructor(baseDir = BASE_DATA_DIR) {
    this.ledgerDir = join(baseDir, 'approval-ledger');
    this.worktreesDir = join(baseDir, 'approval-worktrees');
    this.lockPath = join(baseDir, 'approval-ledger.lock');
  }

  prepareAdminAudit(workingDirectory: string, instanceId: string, prompt: string): AdminAuditContext {
    const targetRepo = resolveGitRoot(workingDirectory);
    const dirty = runGit(targetRepo, ['status', '--porcelain']).stdout;
    if (dirty) {
      throw new Error(`Target repository has uncommitted changes: ${targetRepo}`);
    }
    const baseHead = runGit(targetRepo, ['rev-parse', 'HEAD']).stdout;
    const targetBranch = runGit(targetRepo, ['branch', '--show-current']).stdout;
    if (!targetBranch) throw new Error('Admin write access requires the target repository to be on a branch');
    return { instanceId, targetRepo, baseHead, targetBranch, prompt: prompt.trim() };
  }

  finalizeAdminAudit(context: AdminAuditContext, executionError?: string): AdminAuditFinalization {
    const dirty = runGit(context.targetRepo, ['status', '--porcelain']).stdout;
    if (dirty) {
      runGit(context.targetRepo, ['add', '-A']);
      const prefix = executionError ? 'checkpoint failed admin task' : 'admin task';
      runGit(context.targetRepo, [
        '-c', 'user.name=WeChat Claude Code',
        '-c', 'user.email=wechat-claude-code@localhost',
        'commit', '-m', `wcc: ${prefix} by ${context.instanceId} - ${sanitizeSubject(context.prompt)}`,
      ]);
    }
    const commit = runGit(context.targetRepo, ['rev-parse', 'HEAD']).stdout;
    if (commit === context.baseHead) return {};
    return {
      commit,
      message: executionError
        ? `管理员任务的部分修改已保存为 ${commit}。`
        : `管理员修改已保存为 Git 提交 ${commit}。`,
    };
  }

  submit(input: {
    requesterInstanceId: string;
    requesterAccountId: string;
    workingDirectory: string;
    prompt: string;
  }): ChangeRequest {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('Change request cannot be empty');
    if (prompt.length > 20_000) throw new Error('Change request is too long (max 20000 characters)');
    const targetCwd = resolve(input.workingDirectory);
    const targetRepo = resolveGitRoot(targetCwd);
    const targetRelativePath = relative(targetRepo, targetCwd);
    if (targetRelativePath.startsWith('..')) {
      throw new Error(`Working directory is outside the target repository: ${targetCwd}`);
    }

    return this.withLock(() => {
      this.ensureLedger();
      const now = new Date().toISOString();
      const id = `${now.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
      const request: ChangeRequest = {
        id,
        status: 'pending',
        requesterInstanceId: input.requesterInstanceId,
        requesterAccountId: input.requesterAccountId,
        targetRepo,
        targetCwd,
        prompt,
        createdAt: now,
        updatedAt: now,
      };
      this.writeRequest(request, `request ${id} from ${input.requesterInstanceId}`);
      return request;
    });
  }

  list(status?: ChangeRequestStatus): ChangeRequest[] {
    return this.withLock(() => {
      this.ensureLedger();
      const requestsDir = join(this.ledgerDir, 'requests');
      if (!existsSync(requestsDir)) return [];
      return readdirSync(requestsDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(join(requestsDir, name), 'utf8')) as ChangeRequest)
        .filter((request) => !status || request.status === status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    });
  }

  get(id: string): ChangeRequest {
    this.validateRequestId(id);
    const path = this.requestPath(id);
    if (!existsSync(path)) throw new Error(`Change request not found: ${id}`);
    return JSON.parse(readFileSync(path, 'utf8')) as ChangeRequest;
  }

  reject(id: string, reviewerInstanceId: string, reason?: string): ChangeRequest {
    return this.withLock(() => {
      this.ensureLedger();
      const request = this.get(id);
      if (request.status !== 'pending') {
        throw new Error(`Only pending requests can be rejected (current: ${request.status})`);
      }
      const now = new Date().toISOString();
      request.status = 'rejected';
      request.reviewerInstanceId = reviewerInstanceId;
      request.reviewedAt = now;
      request.rejectionReason = reason?.trim() || undefined;
      request.updatedAt = now;
      this.writeRequest(request, `reject ${id}`);
      return request;
    });
  }

  prepareApproval(id: string, reviewerInstanceId: string): ApprovalExecution {
    return this.withLock(() => {
      this.ensureLedger();
      const request = this.get(id);
      if (request.status !== 'pending') {
        throw new Error(`Only pending requests can be approved (current: ${request.status})`);
      }

      const targetRepo = resolveGitRoot(request.targetRepo);
      const dirty = runGit(targetRepo, ['status', '--porcelain']).stdout;
      if (dirty) {
        throw new Error(`Target repository has uncommitted changes: ${targetRepo}`);
      }
      const baseHead = runGit(targetRepo, ['rev-parse', 'HEAD']).stdout;
      const targetBranch = runGit(targetRepo, ['branch', '--show-current']).stdout;
      if (!targetBranch) throw new Error('Approval requires the target repository to be on a branch');

      const proposalBranch = `wcc/request/${request.id}`;
      const worktreePath = join(this.worktreesDir, request.id);
      mkdirSync(dirname(worktreePath), { recursive: true });
      if (existsSync(worktreePath)) throw new Error(`Approval worktree already exists: ${worktreePath}`);
      runGit(targetRepo, ['worktree', 'add', '-b', proposalBranch, worktreePath, baseHead]);

      const now = new Date().toISOString();
      Object.assign(request, {
        status: 'executing' as const,
        reviewerInstanceId,
        reviewedAt: now,
        updatedAt: now,
        baseHead,
        targetBranch,
        proposalBranch,
        worktreePath,
      });
      this.writeRequest(request, `approve ${id}`);

      return {
        request,
        cwd: join(worktreePath, relative(targetRepo, request.targetCwd || targetRepo)),
        prompt: [
          `Implement approved change request ${request.id}.`,
          `Original requester: ${request.requesterInstanceId}`,
          '',
          request.prompt,
          '',
          'Work only inside the current Git worktree.',
          'Do not run git commit, git merge, git reset, or git checkout; the bridge will create and merge the audit commit.',
        ].join('\n'),
      };
    });
  }

  finalizeApproval(id: string, executionError?: string): ApprovalFinalization {
    return this.withLock(() => {
      this.ensureLedger();
      const request = this.get(id);
      if (request.status !== 'executing' || !request.worktreePath || !request.baseHead || !request.targetBranch) {
        throw new Error(`Request is not executing: ${id}`);
      }

      const worktreePath = request.worktreePath;
      const targetRepo = resolveGitRoot(request.targetRepo);
      const dirty = runGit(worktreePath, ['status', '--porcelain']).stdout;
      if (dirty) {
        runGit(worktreePath, ['add', '-A']);
        const subject = sanitizeSubject(request.prompt);
        const prefix = executionError ? 'checkpoint failed request' : 'apply request';
        runGit(worktreePath, [
          '-c', 'user.name=WeChat Claude Code',
          '-c', 'user.email=wechat-claude-code@localhost',
          'commit', '-m', `wcc: ${prefix} ${request.id} - ${subject}`,
        ]);
      }

      const resultCommit = runGit(worktreePath, ['rev-parse', 'HEAD']).stdout;
      const now = new Date().toISOString();
      request.resultCommit = resultCommit;
      request.updatedAt = now;
      request.error = executionError;

      let message: string;
      if (resultCommit === request.baseHead) {
        request.status = executionError ? 'failed' : 'no_changes';
        message = executionError
          ? `Request ${id} failed without file changes: ${executionError}`
          : `Request ${id} completed without file changes.`;
      } else if (executionError) {
        request.status = 'failed';
        message = `Request ${id} failed; partial changes were saved in ${request.proposalBranch} at ${resultCommit}.`;
      } else {
        const currentBranch = runGit(targetRepo, ['branch', '--show-current']).stdout;
        const currentHead = runGit(targetRepo, ['rev-parse', 'HEAD']).stdout;
        const targetDirty = runGit(targetRepo, ['status', '--porcelain']).stdout;
        if (currentBranch === request.targetBranch && currentHead === request.baseHead && !targetDirty) {
          runGit(targetRepo, ['merge', '--ff-only', resultCommit]);
          request.status = 'completed';
          message = `Request ${id} merged as ${resultCommit}.`;
        } else {
          request.status = 'ready';
          message = `Request ${id} is committed at ${resultCommit}, but the target branch changed; merge ${request.proposalBranch} manually.`;
        }
      }

      const worktreeStatus = runGit(worktreePath, ['status', '--porcelain'], true).stdout;
      if (!worktreeStatus) {
        const removal = runGit(targetRepo, ['worktree', 'remove', worktreePath], true);
        if (removal.status === 0 || !existsSync(worktreePath)) {
          request.worktreePath = undefined;
        }
      }
      this.writeRequest(request, `finalize ${id}: ${request.status}`);
      return { request, message };
    });
  }

  private ensureLedger(): void {
    mkdirSync(this.ledgerDir, { recursive: true });
    if (!existsSync(join(this.ledgerDir, '.git'))) {
      runGit(this.ledgerDir, ['init', '-b', 'main']);
    }
  }

  private requestPath(id: string): string {
    this.validateRequestId(id);
    return join(this.ledgerDir, 'requests', `${id}.json`);
  }

  private validateRequestId(id: string): void {
    if (!/^\d{14}-[a-f0-9]{6}$/.test(id)) throw new Error(`Invalid change request id: ${id}`);
  }

  private writeRequest(request: ChangeRequest, commitMessage: string): void {
    const path = this.requestPath(request.id);
    atomicWriteJson(path, request);
    const relativePath = join('requests', basename(path));
    runGit(this.ledgerDir, ['add', '--', relativePath]);
    const changed = runGit(this.ledgerDir, ['status', '--porcelain', '--', relativePath]).stdout;
    if (!changed) return;
    runGit(this.ledgerDir, [
      '-c', 'user.name=WeChat Claude Code',
      '-c', 'user.email=wechat-claude-code@localhost',
      'commit', '-m', commitMessage, '--', relativePath,
    ]);
  }

  private withLock<T>(operation: () => T): T {
    return withFileLock(this.lockPath, 'Approval ledger is busy; retry shortly', operation);
  }
}
