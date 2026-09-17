import type { Json } from '@game-ai/core';

export type BehaviorNode =
  | { type: 'selector' | 'sequence'; children: BehaviorNode[] }
  | { type: 'condition'; ruleId: string; params: Record<string, Json> }
  | { type: 'action'; actionId: string; params: Record<string, Json> };
export interface BehaviorDefinition { id: string; npcId: string; intervalMs: number; root: BehaviorNode }
export type BehaviorCursor = Record<string, 'success' | 'failure'>;
export interface BehaviorChoice {
  status: 'success' | 'failure' | 'running';
  action?: Extract<BehaviorNode, { type: 'action' }>; path?: string; completed: BehaviorCursor;
}

export function validateBehavior(value: unknown, actions: readonly string[], rules: readonly string[], validateCondition?: (id: string, params: Record<string, Json>) => void, validateAction?: (id: string, params: Record<string, Json>) => void): asserts value is BehaviorDefinition {
  const exact = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
  const tree = value as BehaviorDefinition;
  if (!exact(tree, ['id', 'npcId', 'intervalMs', 'root']) || typeof tree.id !== 'string' || !tree.id || typeof tree.npcId !== 'string' || !tree.npcId || !Number.isSafeInteger(tree.intervalMs) || tree.intervalMs <= 0) throw Error('INVALID_BEHAVIOR');
  let count = 0;
  const seen = new Set<object>();
  function visit(node: BehaviorNode, depth: number) {
    if (!node || typeof node !== 'object' || ++count > 64 || depth > 8 || seen.has(node)) throw Error('INVALID_BEHAVIOR');
    seen.add(node);
    if (node.type === 'selector' || node.type === 'sequence') {
      if (!exact(node, ['type', 'children']) || !Array.isArray(node.children) || !node.children.length) throw Error('INVALID_BEHAVIOR');
      node.children.forEach(child => visit(child, depth + 1));
    } else if (node.type === 'action' || node.type === 'condition') {
      const key = node.type === 'action' ? 'actionId' : 'ruleId';
      if (!exact(node, ['type', key, 'params']) || !node.params || typeof node.params !== 'object' || Array.isArray(node.params)) throw Error('INVALID_BEHAVIOR');
      if (node.type === 'action' && !actions.includes(node.actionId)) throw Error('UNKNOWN_ACTION');
      if (node.type === 'condition' && !rules.includes(node.ruleId)) throw Error('UNKNOWN_RULE');
      if (node.type === 'condition') validateCondition?.(node.ruleId, node.params);
      if (node.type === 'action') validateAction?.(node.actionId, node.params);
    } else throw Error('INVALID_BEHAVIOR');
  }
  visit(tree.root, 1);
}

export function chooseBehavior(tree: BehaviorDefinition, condition: (id: string, params: Record<string, Json>) => boolean, completed: BehaviorCursor): BehaviorChoice {
  const branches: { parent: string; child: string }[] = [];
  function visit(node: BehaviorNode, path: string): Omit<BehaviorChoice, 'completed'> {
    if (node.type === 'condition') return { status: condition(node.ruleId, node.params) ? 'success' : 'failure' };
    if (node.type === 'action') return completed[path] ? { status: completed[path] } : { status: 'running', action: node, path };
    for (let i = 0; i < node.children.length; i++) {
      const childPath = `${path}.${i}`;
      const saved = branches.length;
      const result = visit(node.children[i], childPath);
      if (node.type === 'sequence' && result.status !== 'success') return result;
      if (node.type === 'selector' && result.status !== 'failure') {
        branches.push({ parent: `${path}.`, child: childPath });
        return result;
      }
      if (node.type === 'selector') branches.length = saved;
    }
    return { status: node.type === 'sequence' ? 'success' : 'failure' };
  }
  const result = visit(tree.root, 'root');
  const retained = Object.fromEntries(Object.entries(completed).filter(([path]) => branches.every(b => !path.startsWith(b.parent) || path === b.child || path.startsWith(`${b.child}.`))));
  return { ...result, completed: result.status === 'running' ? retained : {} };
}
