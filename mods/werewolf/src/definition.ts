import type { Json } from '@game-ai/core';
import type { RoomDefinition } from '@game-ai/turn-based';
import { createMatch, decideMatch, matchPhase, type Match, type MatchOptions } from './match.ts';
import { projectGame, revealGame } from './views.ts';

/** Ordinary decision adapter. Concurrent interrupt dispatch awaits the framework v2 contract. */
export function werewolfDefinition(options: MatchOptions): RoomDefinition {
  const config = { ...options };
  return {
    id: 'werewolf', version: `2.${config.seed}.${config.sheriff}`, seats: 12,
    instructions: '你是十二人预女猎白的一名玩家。只根据授权事实和自己的身份决策，不得假设未知身份。按当前JSON Schema选择行动；发言最多300字。狼人屠边，好人消灭狼人，双方同时达标平局；所有出局链结束再结算。狼刀忽略空刀票，女巫不可自救且每夜单药，预言家不可连续查验同一人。警长放逐票权1.5，白痴翻牌后无投票权且不可被投。',
    initialize: () => {
      const match = createMatch(config);
      return { state: match as unknown as Json, phase: matchPhase(match)! };
    },
    project: (state, viewer) => {
      const match = state as unknown as Match;
      const phase = ['wolves', 'witch', 'seer'].includes(match.stage) ? match.stage as 'wolves' | 'witch' | 'seer' : 'day';
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
      const state = match as unknown as Json;
      const events = match.events.slice(offset);
      const phase = matchPhase(match);
      return phase ? { state, phase, events } : { state, result: match.result as Json, events };
    },
    reveal: state => revealGame((state as unknown as Match).game) as unknown as Json,
  };
}
