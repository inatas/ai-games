export function acceptSnapshot<T extends { id: string; memoryVersion: number }>(scopeId: string, current: T | null, incoming: T): T | null {
  if (incoming.id !== scopeId || (current && incoming.memoryVersion < current.memoryVersion)) return current;
  return incoming;
}
