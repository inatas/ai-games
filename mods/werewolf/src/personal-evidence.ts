import type { Json } from '@game-ai/core';

type Basis = { visibility: 'public' | 'private'; sequence: number };
type Entry = { topicKey: string; judgment: string; basis: Basis[] };
type Payload = { entries: Entry[] };

const keyPattern = /^[a-z0-9:.-]{1,64}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).sort().join(',') === [...expected].sort().join(',');

/** A personal view is untrusted model output, never a referee fact. */
export function parsePersonalEvidenceUpdate(proposal: Json, facts: Json, previous: Json | null): Json | null {
  if (!object(proposal) || !object(facts)) return null;
  const raw = proposal.personal_evidence_update;
  if (!object(raw) || !keys(raw, ['upserts', 'removeKeys']) ||
      !Array.isArray(raw.upserts) || raw.upserts.length > 2 ||
      !Array.isArray(raw.removeKeys) || raw.removeKeys.length > 4) return null;
  const history = Array.isArray(facts.public_history) ? facts.public_history : [];
  const privateInfo = facts.private_information;
  const privateEvents = object(privateInfo) && Array.isArray(privateInfo.events) ? privateInfo.events : [];
  const publicSequences = new Set(history.flatMap(event =>
    object(event) && Number.isSafeInteger(event.sequence) ? [event.sequence as number] : []));
  const privateSequences = new Set(privateEvents.flatMap(event =>
    object(event) && Number.isSafeInteger(event.sequence) ? [event.sequence as number] : []));
  const oldEntries = previous === null ? [] : object(previous) && Array.isArray(previous.entries) ? previous.entries : null;
  if (oldEntries === null || oldEntries.some(item => !object(item) || typeof item.topicKey !== 'string')) return null;
  const merged = new Map<string, Entry>((oldEntries as Entry[]).map(item => [item.topicKey, item]));
  const removed = new Set<string>();
  for (const value of raw.removeKeys) {
    if (typeof value !== 'string' || !keyPattern.test(value) || removed.has(value) || !merged.has(value)) return null;
    removed.add(value);
  }
  const upserted = new Set<string>();
  const updates: Entry[] = [];
  for (const value of raw.upserts) {
    if (!object(value) || !keys(value, ['topicKey', 'judgment', 'basis']) ||
        typeof value.topicKey !== 'string' || !keyPattern.test(value.topicKey) ||
        removed.has(value.topicKey) || upserted.has(value.topicKey) ||
        typeof value.judgment !== 'string' || !value.judgment.trim() ||
        [...value.judgment].length > 100 || !Array.isArray(value.basis) ||
        value.basis.length < 1 || value.basis.length > 3) return null;
    const basis: Basis[] = [];
    const seen = new Set<string>();
    for (const source of value.basis) {
      if (!object(source) || !keys(source, ['visibility', 'sequence']) ||
          (source.visibility !== 'public' && source.visibility !== 'private') ||
          !Number.isSafeInteger(source.sequence) || (source.sequence as number) <= 0 ||
          !(source.visibility === 'public' ? publicSequences : privateSequences).has(source.sequence as number)) return null;
      const id = `${source.visibility}:${source.sequence}`;
      if (seen.has(id)) return null;
      seen.add(id);
      basis.push({ visibility: source.visibility, sequence: source.sequence as number });
    }
    upserted.add(value.topicKey);
    updates.push({ topicKey: value.topicKey, judgment: value.judgment.trim(), basis });
  }
  if (!removed.size && !updates.length) return null;
  for (const key of removed) merged.delete(key);
  for (const item of updates) merged.set(item.topicKey, item);
  if (merged.size > 24) return null;
  return { entries: [...merged.values()].sort((a, b) => a.topicKey.localeCompare(b.topicKey)) } satisfies Payload;
}
