import type { Json } from '@game-ai/core';
import type { RoomDefinition, Transition } from '@game-ai/turn-based';
import { createMatch, decideMatch, explodeMatch, explosionActors, matchPhase, type Match, type MatchOptions } from './match.ts';
import { projectGame, revealGame } from './views.ts';
import { prepareWerewolfDecision } from './decision-input.ts';
import { decodeWerewolfDecision } from './decision-adapter.ts';
import { fallbackWerewolfAction } from './fallback.ts';

function transition(match: Match, eventOffset: number): Transition {
  const state = match as unknown as Json;
  const events = match.events.slice(eventOffset);
  const phase = matchPhase(match);
  return phase ? { state, phase, events } : { state, result: match.result as Json, events };
}

/** Ordinary and independent interrupt decisions share the same authoritative Match state. */
export function werewolfDefinition(options: MatchOptions): RoomDefinition {
  const config = { ...options };
  const definition: RoomDefinition = {
    id: 'werewolf', version: `4.${config.seed}.${config.sheriff}`, seats: 12,
    instructions: '你是十二人预女猎白的一名玩家。只根据授权事实和自己的身份决策，不得假设未知身份。按当前JSON Schema选择行动；发言最多300字。狼人屠边，好人消灭狼人，双方同时达标平局；所有出局链结束再结算。狼刀忽略空刀票，女巫不可自救且每夜单药，预言家不可连续查验同一人。警长放逐票权1.5，白痴翻牌后无投票权且不可被投。',
    initialize: () => {
      const match = createMatch(config);
      return { state: match as unknown as Json, phase: matchPhase(match)! };
    },
    project: (state, viewer) => {
      const match = state as unknown as Match;
      const phase = ['wolves', 'witch'].includes(match.stage) ? match.stage as 'wolves' | 'witch' : 'day';
      return projectGame(match.game, viewer, { phase, knife: match.knife }) as unknown as Json;
    },
    validate: (state, _phase, seat, value) => {
      const match = state as unknown as Match;
      try { decideMatch(match, match.revision, seat, value); return true; } catch { return false; }
    },
    resolve: (source, _phase, decisions) => {
      let match = source as unknown as Match;
      const offset = match.events.length;
      for (const decision of decisions) match = decideMatch(match, match.revision, decision.seat, decision.value);
      return transition(match, offset);
    },
    decisionSpec: (room, seat) => prepareWerewolfDecision(room, seat, definition),
    decodeDecision: decodeWerewolfDecision,
    fallbackDecision: (room, seat) => fallbackWerewolfAction(room, seat, definition),
    fixedWindow: () => true,
    actionWindowMs: room => room.phase?.key === 'wolves' ? 60_000 : definition.windowMs!(room),
    windowMs: room => {
      const key = room.phase?.key;
      if (key === 'wolves') return (room.state as unknown as Match).game.players.some(player => player.alive && player.role === 'witch') ? 60_000 : 90_000;
      if (key === 'witch') return 30_000;
      if (key === 'speech') {
        const actor = room.phase?.actors[0];
        return (room.state as unknown as Match).game.sheriff === actor ? 150_000 : 120_000;
      }
      if (key === 'election-speech') return 120_000;
      if (['pk', 'election-pk', 'last-words'].includes(key ?? '')) return 90_000;
      if (['direction', 'election-withdrawal', 'badge-transfer'].includes(key ?? '')) return 20_000;
      return 30_000;
    },
    validateInterrupt: (source, _phase, seat, value) => {
      const match = source as unknown as Match;
      const kind = (value as { kind?: string })?.kind;
      return explosionActors(match).includes(seat) && (kind === 'pass' || kind === 'explode');
    },
    resolveInterrupt: (source, _phase, seat, value) => {
      const match = source as unknown as Match;
      if ((value as { kind: string }).kind === 'pass') return { pass: true };
      return transition(explodeMatch(match, match.revision, seat), match.events.length);
    },
    reveal: state => revealGame((state as unknown as Match).game) as unknown as Json,
  };
  return definition;
}
