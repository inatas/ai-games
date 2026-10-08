import type { Json } from '@game-ai/core';
import type { RoomDefinition, Transition } from '@game-ai/turn-based';
import { createMatch, decideMatch, explodeMatch, explosionActors, matchPhase, type Match, type MatchOptions } from './match.ts';
import { projectGame, revealGame } from './views.ts';
import { prepareWerewolfDecision } from './decision-input.ts';
import { decodeWerewolfDecision } from './decision-adapter.ts';
import { fallbackWerewolfAction } from './fallback.ts';
import { werewolfDecisionRules } from './decision-rules/index.ts';
import { maxSpeechChars } from './speech-policy.ts';
import { currentBoardId, werewolfKnowledge } from './knowledge.ts';
import { publicEvidenceVersion } from './public-evidence.ts';
import { decisionMemoryKey, parseDecisionMemoryUpdate } from './decision-memory.ts';

function transition(match: Match, eventOffset: number): Transition {
  const state = match as unknown as Json;
  const events = match.events.slice(eventOffset);
  const phase = matchPhase(match);
  return phase ? { state, phase, events } : { state, result: match.result as Json, events };
}

/** Ordinary and independent interrupt decisions share the same authoritative Match state. */
export function werewolfDefinition(options: MatchOptions): RoomDefinition {
  const config = { ...options };
  if (config.boardId !== undefined && config.boardId !== currentBoardId) throw new Error('UNKNOWN_BOARD');
  const definition: RoomDefinition = {
    id: 'werewolf', version: `5.${config.seed}.${config.sheriff}.${currentBoardId}.${werewolfKnowledge.digest}.${publicEvidenceVersion}.c4.pm2.t2`, seats: 12,
    instructions: `你是当前狼人杀对局的一名玩家。板子、职业和术语以随后提供的知识库为背景，实际游戏状态和行动以裁判的当前授权事实与合法选项为准。只根据授权事实和自己的身份决策，不得假设未知身份。game_state与public_history是公共事实；发言只证明玩家说过，不证明发言内容属实。self与private_information是本人获授权的事实。私密狼刀口只代表攻击目标，不代表目标已经死亡；实际夜死以公开公告和存活状态为准。你可以策略性伪装身份或谎报查验，但公开说辞不是真实身份或技能结果，不能把自己的谎报写成实际查验或用药事实；私有判断仍须区分授权事实、推测和对外说辞。角色指南是可随局势调整的建议，不授予额外权限，不证明队友已经同意某个计划。按当前JSON Schema选择行动；发言最多${maxSpeechChars}字。每次行动可用personal_evidence_update更新仅供自己下次决策参考的判断：upserts最多2条，每条包含topicKey、简短judgment及可见事件的basis；removeKeys可撤回旧判断。没有变化时用空数组，不得把判断当作裁判事实。`,
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
    privateMemoryUpdate: { factKey: decisionMemoryKey, parseUpdate: parseDecisionMemoryUpdate },
    decisionRules: werewolfDecisionRules,
    fallbackDecision: (room, seat) => fallbackWerewolfAction(room, seat, definition),
    fixedWindow: () => true,
    actionWindowMs: room => room.phase?.key === 'wolves' ? 60_000 : definition.windowMs!(room),
    windowMs: room => {
      const key = room.phase?.key;
      if (key === 'wolves') return (room.state as unknown as Match).game.players.some(player => player.alive && player.role === 'witch') ? 60_000 : 90_000;
      if (key === 'witch') return 30_000;
      if (key === 'speech') {
        const actor = room.phase?.actors[0];
        return (room.state as unknown as Match).game.sheriff === actor ? 120_000 : 90_000;
      }
      if (key === 'election-speech') return 90_000;
      if (['pk', 'election-pk', 'last-words'].includes(key ?? '')) return 90_000;
      if (key === 'election-withdrawal') return 10_000;
      if (['direction', 'badge-transfer'].includes(key ?? '')) return 20_000;
      if (['nominations', 'election-voting', 'vote'].includes(key ?? '')) return 20_000;
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
  definition.instructions += '每次关键交互也可附strategy_update，仅保存本人的战术意向，不证明行动、身份或队友同意。格式为{"set":null}撤回，或{"set":{"tactic":"1至24字标签","claimedRole":null,"intendedReports":[],"voteTarget":null,"nextStep":"1至80字下一步","changeReason":"0至60字调整理由","teamPlanRef":null}}替换。claimedRole为本板职业ID或null；intendedReports最多4条，每条为{night:正整数,targetSeat:1至12,alignment:"good"或"wolf"}，只是准备说出的报验而非真实查验；voteTarget为座位或null。修改已有打法、身份说辞或报验计划须有changeReason。teamPlanRef若非null，只能是本次私有上下文已发布未过期方案的{planId,version}，引用不代表接受或全队共识。无变化可以不附。当前事实与真实公开历史优先，改计划不改历史。证据更新和计划更新分别校验，附加格式错不阻断合法行动。';
  return definition;
}
