import type { Json } from '@game-ai/core';

export interface DemoSnapshot {
  id: string;
  revision: number;
  status: 'running' | 'finished' | 'aborted' | 'waiting' | 'blocked';
  day: number;
  period: 'day' | 'night';
  phaseLabel: string;
  actor: number | null;
  progress: { submitted: number; eligible: number } | null;
  sheriff: number | null;
  players: { seat: number; alive: boolean; revealedRole?: 'idiot' }[];
  events: { type: string; data: Json }[];
  result: Json;
  roles?: { seat: number; role: string }[];
  replay?: { day: number; period: 'day' | 'night'; events: { type: string; data: Json }[] }[];
}

