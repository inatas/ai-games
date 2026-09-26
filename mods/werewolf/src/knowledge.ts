import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_ROLES, type Role } from './rules.ts';

export const currentBoardId = '12p-seer-witch-hunter-idiot';
const defaultRoot = fileURLToPath(new URL('../knowledge/', import.meta.url));

export interface KnowledgeEntry { id: string; content: string }
export interface WerewolfKnowledge {
  boardId: string;
  digest: string;
  sharedKnowledge: KnowledgeEntry[];
  guides: Record<Role, KnowledgeEntry>;
}

function loadText(root: string, section: string, id: string): string {
  if (!/^[\p{L}\p{N}-]+$/u.test(id)) throw new Error('KNOWLEDGE_INVALID_ID');
  let content: string;
  try { content = readFileSync(join(root, section, `${id}.md`), 'utf8'); }
  catch { throw new Error('KNOWLEDGE_MISSING'); }
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('KNOWLEDGE_EMPTY');
  return normalized;
}

/** File I/O is isolated here; the game judge still uses code, never Markdown, for actions. */
export function loadWerewolfKnowledge(root = defaultRoot): WerewolfKnowledge {
  const roleIds = [...new Set(BOARD_ROLES)].sort() as Role[];
  const board: KnowledgeEntry = { id: `board:${currentBoardId}`,
    content: loadText(root, 'boards', currentBoardId) };
  const roles = roleIds.map(role => ({ id: `role:${role}`, content: loadText(root, 'roles', role) }));
  let terms: string[];
  try { terms = readdirSync(join(root, 'terms')).filter(name => name.endsWith('.md'))
    .map(name => name.slice(0, -3)).sort(); }
  catch { throw new Error('KNOWLEDGE_MISSING'); }
  if (!terms.length) throw new Error('KNOWLEDGE_MISSING');
  const normalizedIds = terms.map(id => id.normalize('NFKC').toLocaleLowerCase('en'));
  if (new Set(normalizedIds).size !== terms.length) throw new Error('KNOWLEDGE_DUPLICATE_ID');
  const glossary = terms.map(id => ({ id: `term:${id}`, content: loadText(root, 'terms', id) }));
  const guides = Object.fromEntries(roleIds.map(role => [role, {
    id: `guide:${role}`, content: loadText(root, 'guides', role),
  }])) as Record<Role, KnowledgeEntry>;
  const sharedKnowledge = [board, ...roles, ...glossary];
  const digest = createHash('sha256').update(JSON.stringify({ boardId: currentBoardId,
    sharedKnowledge, guides: roleIds.map(role => guides[role]) })).digest('hex');
  return { boardId: currentBoardId, digest, sharedKnowledge, guides };
}

/** Select from a frozen catalog using only the trusted, actual role of this seat. */
export function selectWerewolfKnowledge(catalog: WerewolfKnowledge, role: Role) {
  const privateKnowledge = catalog.guides[role];
  if (!privateKnowledge) throw new Error('KNOWLEDGE_ROLE_MISSING');
  return { sharedKnowledge: catalog.sharedKnowledge, privateKnowledge };
}

/** Loaded once per process; editing Markdown requires a restart and a new room version. */
export const werewolfKnowledge = loadWerewolfKnowledge();
