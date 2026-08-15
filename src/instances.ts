import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withFileLock } from './file-lock.js';
import { loadJson, saveJson } from './store.js';
import {
  BASE_DATA_DIR,
  INSTANCE_DATA_DIR,
  INSTANCE_ID,
  type InstanceRole,
  validateInstanceId,
} from './runtime.js';

export interface InstanceConfig {
  id: string;
  role: InstanceRole;
  accountId?: string;
  createdAt: string;
  updatedAt: string;
}

function instanceConfigPath(dataDir: string): string {
  return join(dataDir, 'instance.json');
}

function withInstanceLock<T>(operation: () => T): T {
  const lockPath = join(BASE_DATA_DIR, 'instances.lock');
  return withFileLock(lockPath, 'Instance registry is busy; retry shortly', operation);
}

function defaultInstanceConfig(): InstanceConfig {
  const now = new Date().toISOString();
  return {
    id: INSTANCE_ID,
    role: INSTANCE_ID === 'default' ? 'admin' : 'requester',
    createdAt: now,
    updatedAt: now,
  };
}

export function loadCurrentInstance(): InstanceConfig {
  const config = loadJson<InstanceConfig>(instanceConfigPath(INSTANCE_DATA_DIR), defaultInstanceConfig());
  if (config.id !== INSTANCE_ID) throw new Error(`Instance config id mismatch: expected ${INSTANCE_ID}, got ${config.id}`);
  if (config.role !== 'admin' && config.role !== 'requester') throw new Error(`Invalid instance role: ${config.role}`);
  return config;
}

export function isCurrentInstanceConfigured(): boolean {
  return existsSync(instanceConfigPath(INSTANCE_DATA_DIR));
}

export function listInstances(): InstanceConfig[] {
  const configs: InstanceConfig[] = [];
  const defaultPath = instanceConfigPath(BASE_DATA_DIR);
  if (existsSync(defaultPath)) {
    const config = loadJson<InstanceConfig | null>(defaultPath, null);
    if (config) configs.push(config);
  } else {
    const legacyAccounts = join(BASE_DATA_DIR, 'accounts');
    if (existsSync(legacyAccounts) && readdirSync(legacyAccounts).some((name) => name.endsWith('.json'))) {
      configs.push({
        id: 'default',
        role: 'admin',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });
    }
  }

  const instancesDir = join(BASE_DATA_DIR, 'instances');
  if (existsSync(instancesDir)) {
    for (const name of readdirSync(instancesDir)) {
      const path = instanceConfigPath(join(instancesDir, name));
      if (!existsSync(path)) continue;
      const config = loadJson<InstanceConfig | null>(path, null);
      if (config && !configs.some((item) => item.id === config.id)) configs.push(config);
    }
  }
  return configs;
}

export function hasAdminInstance(exceptId?: string): boolean {
  return listInstances().some((instance) => instance.role === 'admin' && instance.id !== exceptId);
}

export function saveCurrentInstance(input: {
  role: InstanceRole;
  accountId?: string;
}): InstanceConfig {
  return withInstanceLock(() => {
    validateInstanceId(INSTANCE_ID);
    if (input.role === 'admin' && hasAdminInstance(INSTANCE_ID)) {
      const currentAdmin = listInstances().find((instance) => instance.role === 'admin' && instance.id !== INSTANCE_ID);
      throw new Error(`Admin instance already exists: ${currentAdmin?.id ?? 'unknown'}`);
    }

    const existing = loadJson<InstanceConfig | null>(instanceConfigPath(INSTANCE_DATA_DIR), null);
    const now = new Date().toISOString();
    const config: InstanceConfig = {
      id: INSTANCE_ID,
      role: input.role,
      accountId: input.accountId ?? existing?.accountId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    saveJson(instanceConfigPath(INSTANCE_DATA_DIR), config);
    return config;
  });
}
