import { homedir } from 'node:os';
import { join } from 'node:path';

export type InstanceRole = 'admin' | 'requester';

export interface RuntimeOptions {
  command: string;
  instanceId: string;
  role?: InstanceRole;
}

const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

export function validateInstanceId(instanceId: string): void {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw new Error(`Invalid instance id: "${instanceId}"`);
  }
}

export function parseRuntimeOptions(args: string[]): RuntimeOptions {
  let command = 'start';
  let commandFound = false;
  let instanceId = process.env.WCC_INSTANCE?.trim() || 'default';
  let role: InstanceRole | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--instance') {
      instanceId = args[++index]?.trim() || '';
      continue;
    }
    if (arg.startsWith('--instance=')) {
      instanceId = arg.slice('--instance='.length).trim();
      continue;
    }
    if (arg === '--role') {
      const value = args[++index]?.trim();
      if (value !== 'admin' && value !== 'requester') {
        throw new Error(`Invalid instance role: "${value ?? ''}"`);
      }
      role = value;
      continue;
    }
    if (arg.startsWith('--role=')) {
      const value = arg.slice('--role='.length).trim();
      if (value !== 'admin' && value !== 'requester') {
        throw new Error(`Invalid instance role: "${value}"`);
      }
      role = value;
      continue;
    }
    if (!arg.startsWith('-') && !commandFound) {
      command = arg;
      commandFound = true;
    }
  }

  validateInstanceId(instanceId);
  return { command, instanceId, role };
}

export const RUNTIME_OPTIONS = parseRuntimeOptions(process.argv.slice(2));
export const BASE_DATA_DIR = process.env.WCC_DATA_DIR || join(homedir(), '.wechat-claude-code');
export const INSTANCE_ID = RUNTIME_OPTIONS.instanceId;
export const INSTANCE_DATA_DIR = INSTANCE_ID === 'default'
  ? BASE_DATA_DIR
  : join(BASE_DATA_DIR, 'instances', INSTANCE_ID);
