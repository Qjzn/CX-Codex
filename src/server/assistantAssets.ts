import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface AssistantAssets {
  version: string;
  core: string;
  workerBrief: string;
  hash: string;
}

const ERROR_MESSAGE = '助手静态资源不可用';

export function readAssistantAssets(
  directory: URL = new URL('./assistant-assets/', import.meta.url),
): AssistantAssets {
  let core: string;
  let workerBrief: string;
  try {
    core = readFileSync(new URL('cxcodex-assistant-core/SKILL.md', directory), 'utf8');
    workerBrief = readFileSync(new URL('worker-brief.md', directory), 'utf8');
  } catch {
    throw new Error(ERROR_MESSAGE);
  }

  if (!core || !workerBrief || core.length > 8000 || workerBrief.length > 4000) {
    throw new Error(ERROR_MESSAGE);
  }

  const hash = createHash('sha256')
    .update(JSON.stringify([core, workerBrief]))
    .digest('hex');

  return Object.freeze({ version: '1', core, workerBrief, hash });
}
