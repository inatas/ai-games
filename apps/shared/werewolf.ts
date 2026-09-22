import type { Perspective } from '../../mods/werewolf/src/perspective.ts';
import type { Json } from '@game-ai/core';

export interface DemoSnapshot {
  perspective?: Perspective;
  id: string;
  revision: number;
  speakerSeat: number | null;
  currentSpeech?: { seat: number; text: string; revision: number } | null;
  nightSegment: 'shared' | 'medicine' | null;
  timing: { remainingMs: number };
  speeches: { sequence: number; day: number; phase: string; seat: number; text: string }[];
  status: 'running' | 'finished' | 'aborted' | 'waiting' | 'blocked';
  day: number;
  period: 'day' | 'night';
  phaseLabel: string;
  actor: number | null;
  progress: { submitted: number; eligible: number } | null;
  sheriff: number | null;
  players: { seat: number; alive: boolean; revealedRole?: 'idiot' }[];
  events: { sequence: number; day: number; period: 'day' | 'night'; type: string; data: Json }[];
  result: Json;
  roles?: { seat: number; role: string }[];
  replay?: { day: number; period: 'day' | 'night'; events: DemoSnapshot['events'] }[];
}

