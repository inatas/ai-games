import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Worldview } from '@game-ai/core';

/** Trusted deployment configuration only; paths never come from player requests. */
export async function loadWorldview(path: string, worldId: string, version: string): Promise<Worldview> {
  if (!path || !/^[a-zA-Z0-9_.-]{1,64}$/.test(worldId) || !/^[a-zA-Z0-9_.-]{1,64}$/.test(version)) throw new Error('INVALID_WORLDVIEW_CONFIG');
  const data = await readFile(path);
  if (data.byteLength > 16384) throw new Error('WORLDVIEW_TOO_LARGE');
  const content = new TextDecoder('utf-8', { fatal: true }).decode(data);
  if (!content.trim()) throw new Error('EMPTY_WORLDVIEW');
  return { worldId, version, content, digest: createHash('sha256').update(content).digest('hex') };
}
