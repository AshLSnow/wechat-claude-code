import { homedir } from 'node:os';
import { join } from 'node:path';
import { BASE_DATA_DIR, INSTANCE_DATA_DIR } from './runtime.js';

export { BASE_DATA_DIR };
export const DATA_DIR = INSTANCE_DATA_DIR;

export const DEFAULT_WORKING_DIR = join(homedir(), 'Documents', 'ClaudeCode');

export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
