import type { RobotUser } from '@game-ai/core';
import { eligibleActors, spectatorView, type Room, type RoomDefinition } from '@game-ai/turn-based';
import type { DemoSnapshot } from '../shared/werewolf.ts';
import type { GameView } from '../src/views.ts';
import { projectPerspective } from '../src/perspective.ts';
import type { Match } from '../src/match.ts';
import { publicRobot } from './robot-users.ts';

/** UI projection. It consumes public game state and only adds roster artwork and finished replay. */
export function modelRoomSnapshot(room: Room, definition: RoomDefinition, users: readonly RobotUser[], now = Date.now(), viewer: number | null = null): DemoSnapshot {
  const publicView = spectatorView(room, definition);
  const state = publicView.state as unknown as GameView;
  const meta = new Map((room.phaseHistory ?? []).map(phase => [phase.instance, {
    day: phase.round, period: ['wolves', 'witch'].includes(phase.key) ? 'night' as const : 'day' as const,
  }]));
  const publicEvents = room.events.filter(event => event.audience === 'public');
  const events = publicEvents.map((event, index) => ({
    sequence: index + 1, ...(meta.get(event.phaseInstance) ?? { day: state.night, period: state.period }),
    type: event.type, data: structuredClone(event.data),
  }));
  const speeches = events.filter(event => ['speech', 'sheriff-speech', 'last-words'].includes(event.type) &&
      typeof (event.data as { text?: string }).text === 'string' && (event.data as { text: string }).text.length > 0)
    .map(event => {
      const data = event.data as { seat: number; text: string; runoff?: boolean };
      return { sequence: event.sequence, day: event.day,
        phase: event.type === 'last-words' ? '遗言' : event.type === 'sheriff-speech'
          ? (data.runoff ? '警长PK发言' : '上警发言') : (data.runoff ? '放逐PK发言' : '放逐发言'),
        seat: data.seat, text: data.text };
    });
  const running = room.status === 'running';
  const speakerPhase = ['speech', 'pk', 'election-speech', 'election-pk', 'last-words'].includes(room.phase?.key ?? '');
  const speakerSeat = running && speakerPhase ? room.phase!.actors[0] : null;
  const speechDecision = room.decisions.find(decision => decision.seat === speakerSeat)?.value as { text?: string } | undefined;
  const speechText = typeof speechDecision?.text === 'string' && speechDecision.text.length > 0 ? speechDecision.text : null;
  const replay = publicView.replay as { players?: { seat: number; role: string }[] } | undefined;
  const night = running && state.period === 'night';
  const nightSegment = !night ? null : room.phase?.key === 'witch' ||
    (room.phase?.key === 'wolves' && room.phaseActionDeadlineAt !== undefined && now >= room.phaseActionDeadlineAt)
    ? 'medicine' as const : 'shared' as const;
  return {
    id: room.id, revision: room.revision, status: room.status,
    perspective: projectPerspective(room.state as unknown as Match, viewer),
    speakerSeat, currentSpeech: speakerSeat !== null && speechText !== null
      ? { seat: speakerSeat, text: speechText, revision: room.revision } : null,
    nightSegment,
    timing: { remainingMs: running ? Math.max(0, Math.min(room.phaseEarlyFinishAt ?? Infinity,
      room.phaseDeadlineAt ?? now) - now) : 0 },
    speeches, day: state.night, period: state.period,
    phaseLabel: running ? room.phase!.label : room.status === 'finished' ? '对局结束' : '对局异常停止',
    phaseTransition: running && state.period === 'day' && ['nominations', 'vote'].includes(room.phase?.key ?? '')
      ? { kind: room.phase!.key === 'nominations' ? 'campaign' : 'exile-vote', id: String(room.phaseInstance) } : null,
    actor: running && !night && room.phase?.mode === 'sequential' ? room.phase.actors[0] : null,
    progress: room.phase?.key === 'vote' ? { submitted: room.decisions.length, eligible: room.phase.actors.length } : null,
    sheriff: state.sheriff,
    players: state.players.map(player => {
      const seat = room.seats.find(item => item.seat === player.seat);
      const user = users.find(item => item.userId === seat?.userId);
      return { ...player, ...(user ? { user: publicRobot(user) } : {}) };
    }),
    events, result: publicView.result,
    ...(room.status === 'finished' ? {
      roles: replay?.players?.map(({ seat, role }) => ({ seat, role })) ?? [],
      replay: room.events.map(event => ({
        sequence: event.sequence, ...(meta.get(event.phaseInstance) ?? { day: state.night, period: state.period }),
        type: event.type, data: structuredClone(event.data),
      })).reduce<NonNullable<DemoSnapshot['replay']>>((frames, event) => {
        const last = frames.at(-1);
        if (last?.day === event.day && last.period === event.period) last.events.push(event);
        else frames.push({ day: event.day, period: event.period, events: [event] });
        return frames;
      }, []),
    } : {}),
  };
}
