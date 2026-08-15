import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

const LOCK_WAIT_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;
const INCOMPLETE_LOCK_STALE_MS = 60_000;

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function removeStaleLock(lockPath: string): boolean {
  try {
    const owner = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
    if (Number.isSafeInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false;
      }
    } else if (Date.now() - statSync(lockPath).mtimeMs < INCOMPLETE_LOCK_STALE_MS) {
      return false;
    }
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

export function withFileLock<T>(lockPath: string, busyMessage: string, operation: () => T): T {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (removeStaleLock(lockPath)) continue;
      if (Date.now() >= deadline) throw new Error(busyMessage);
      sleepSync(LOCK_WAIT_MS);
    }
  }

  try {
    return operation();
  } finally {
    closeSync(descriptor);
    try { unlinkSync(lockPath); } catch { /* best effort */ }
  }
}
