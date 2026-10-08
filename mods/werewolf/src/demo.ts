import { projectPerspective } from './perspective.ts';
import { randomUUID } from 'node:crypto';
import type { RobotUser, ScriptRobotUser, Json } from '@game-ai/core';
import { acceptDecision, createRoom, eligibleActors, occupySeat, spectatorView, type Room, type RoomDefinition } from '@game-ai/turn-based';
import { werewolfDefinition } from './definition.ts';
import type { GameView } from './views.ts';
import { nightActionSchema, type Match } from './match.ts';
import { maxSpeechChars } from './speech-policy.ts';
import { isTeamPhase } from './team-phase.ts';

interface Session {
  roster?: ScriptRobotUser[];
  room: Room;
  definition: RoomDefinition;
  random: number;
  strategy: 'fixed' | 'random';
  revision: number;
  dueAt: number;
  nightTail: boolean;
  touched: number;
  phases: Map<number, { day: number; period: 'day' | 'night' }>;
}
interface Schema { const?: Json; enum?: Json[]; oneOf?: Schema[]; type?: string; properties?: Record<string, Schema> }

/** Local demonstration only: private state and deterministic decisions stay on this host. */
export class DemoRooms {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly speechText: string;

  constructor(options: { now?: () => number; speechText?: string } = {}) {
    this.now = options.now ?? Date.now;
    this.speechText = options.speechText ?? '我是狼人杀玩家';
    if (!this.speechText.trim() || [...this.speechText].length > maxSpeechChars) throw new Error('INVALID_DEMO_SPEECH');
  }

  private budget(session: Session): number {
    const key = session.room.phase?.key;
    if (key === 'wolves') return session.nightTail ? 30_000 : 60_000;
    return session.definition.windowMs!(session.room);
  }

  private waitTime(session: Session): number {
    if (isTeamPhase(session.room.phase?.key)) return this.budget(session);
    return ['wolves', 'witch', 'election-withdrawal', 'speech', 'election-speech', 'pk', 'election-pk', 'last-words'].includes(session.room.phase?.key ?? '') ? this.budget(session) : 3_000;
  }

  create(seed: number, strategy: 'fixed' | 'random', roster?: RobotUser[]) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !['fixed', 'random'].includes(strategy)) throw new Error('INVALID_DEMO_OPTIONS');
    if (roster && (roster.length !== 12 || new Set(roster.map(user => user.userId)).size !== 12)) throw new Error('INVALID_ROSTER');
    const scriptRoster = roster?.map(user => {
      if (user.control.kind !== 'script') throw new Error('MODEL_ROBOT_NOT_READY');
      return { ...user, control: user.control };
    });
    this.expire();
    if (this.sessions.size >= 100) throw new Error('DEMO_CAPACITY');
    const definition = werewolfDefinition({ seed, sheriff: 'double' });
    const id = randomUUID();
    let room = createRoom(id, id, definition);
    for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
      seat, name: roster?.[seat - 1].nickname ?? `${seat}号玩家`, modelProfile: 'fixed-text-demo', scopeId: `seat-${seat}`, interruptScopeId: `interrupt-${seat}`,
    }, definition);
    const session: Session = { roster: scriptRoster ? structuredClone(scriptRoster) : undefined, room, definition, random: (seed ^ 20260963) >>> 0, strategy,
      revision: 0, dueAt: this.now() + definition.windowMs!(room), nightTail: false, touched: this.now(), phases: new Map() };
    session.phases.set(room.phaseInstance, { day: 1, period: 'night' });
    this.sessions.set(id, session);
    return this.snapshot(session);
  }

  private expire(): void {
    for (const [id, session] of this.sessions) if (this.now() - session.touched > 3_600_000) this.sessions.delete(id);
  }

  get(id: string, viewer: number | null = null) {
    const session = this.sessions.get(id);
    if (!session || this.now() - session.touched > 3_600_000) { this.sessions.delete(id); throw new Error('DEMO_NOT_FOUND'); }
    session.touched = this.now();
    return this.snapshot(session, viewer);
  }

  /** Called by the host independently of page reads. Catch up against original deadlines. */
  tick(): void {
    this.expire();
    const now = this.now();
    for (const session of this.sessions.values()) {
      for (let steps = 0; session.room.status === 'running' && session.dueAt <= now && steps < 600; steps++) {
        const draft = { ...session, phases: new Map(session.phases) };
        try {
          this.advance(draft);
          Object.assign(session, draft);
        } catch {
          // No partial choices, random state or events escape a failed transition.
          session.room = { ...session.room, status: 'blocked', error: 'DEMO_TICK_FAILED' };
          session.revision++;
          break;
        }
      }
    }
  }

  private advance(session: Session): void {
    const room = session.room;
    if (room.status !== 'running' || !room.phase) return;
    const match = room.state as unknown as Match;
    // Preserve the same public night duration even when the witch is dead.
    if (room.phase.key === 'wolves' && !session.nightTail && !match.game.players.some(p => p.alive && p.role === 'witch')) {
      session.nightTail = true;
      session.dueAt += 30_000;
      session.revision++;
      return;
    }
    let random = session.random;
    let activeRobot: ScriptRobotUser | undefined;
    const choose = (count: number) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return (activeRobot?.control.strategy ?? session.strategy) === 'fixed' ? 0 : Math.floor(random / 0x100000000 * count);
    };
    const sample = (schema: Schema): Json => {
      if (schema.const !== undefined) return schema.const;
      if (schema.oneOf) return sample(schema.oneOf[choose(schema.oneOf.length)]);
      if (schema.enum) { const options = schema.enum.filter(item => item !== null); return options.length ? options[choose(options.length)] : null; }
      if (schema.type === 'string') return activeRobot?.control.speech ?? this.speechText;
      if (schema.type === 'boolean') return choose(2) === 0;
      if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, sample(value)]));
      throw new Error('UNSUPPORTED_DEMO_ACTION');
    };
    let next = room;
    const actors = room.phase.mode === 'sealed' ? eligibleActors(room) : eligibleActors(room).slice(0, 1);
    for (const actor of actors) {
      activeRobot = session.roster?.[actor - 1];
      const schema = room.phase.key === 'wolves' ? nightActionSchema(match, actor) : room.phase.schema;
      // The fixed-text offline demo cannot author a structured team plan. End preparation at its cutoff.
      const teamPhase = isTeamPhase(room.phase.key);
      next = acceptDecision(next, room.phaseInstance, actor, teamPhase
        ? session.definition.fallbackDecision!(next, actor, 'GAME_DEADLINE') : sample(schema as Schema),
        session.definition, teamPhase ? 'default' : 'script');
    }
    session.room = next;
    session.random = random;
    session.nightTail = false;
    session.revision++;
    session.dueAt += this.waitTime(session);
    const view = spectatorView(next, session.definition).state as unknown as GameView;
    if (!session.phases.has(next.phaseInstance)) session.phases.set(next.phaseInstance, { day: view.night, period: view.period });
  }

  private snapshot(session: Session, viewer: number | null = null) {
    const { room, definition } = session;
    const publicView = spectatorView(room, definition);
    const view = publicView.state as unknown as GameView;
    const vote = view.period === 'day' && room.phase?.key === 'vote';
    const visibleEvents = publicView.events.filter(event => !['decision', 'interrupt'].includes(event.type));
    const publicSequences = new Set(room.events.filter(event => event.audience === 'public').map(event => event.sequence));
    // Public ordinals have no gaps caused by private night actions; they stay stable at finish.
    const events = visibleEvents.filter(event => publicSequences.has(event.sequence))
      .map(({ phaseInstance, type, data }, index) => ({ sequence: index + 1, ...session.phases.get(phaseInstance)!, type, data }));
    const finished = room.status === 'finished';
    const running = room.status === 'running';
    const speeches = events.filter(event => ['speech', 'sheriff-speech', 'last-words'].includes(event.type)).map(event => {
      const data = event.data as { seat: number; text: string; runoff?: boolean };
      return { sequence: event.sequence, day: event.day,
        phase: event.type === 'last-words' ? '遗言' : event.type === 'sheriff-speech' ? (data.runoff ? '警长PK发言' : '上警发言') : (data.runoff ? '放逐PK发言' : '放逐发言'),
        seat: data.seat, text: data.text };
    });
    const nightExtra = room.phase?.key === 'wolves' && !session.nightTail ? 30_000 : 0;
    const nightSegment: 'shared' | 'medicine' | null = !running || view.period !== 'night' ? null
      : isTeamPhase(room.phase?.key) || nightExtra ? 'shared' : 'medicine';
    const speakerSeat = running && view.period === 'day' && ['speech', 'pk', 'election-speech', 'election-pk', 'last-words'].includes(room.phase?.key ?? '') ? eligibleActors(room)[0] ?? null : null;
    const revealed = publicView.replay as unknown as { players: { seat: number; role: string }[] } | undefined;
    return {
      perspective: projectPerspective(room.state as unknown as Match, viewer), id: room.id, revision: session.revision, status: room.status, speeches, speakerSeat, nightSegment, currentSpeech: speakerSeat === null ? null : { seat: speakerSeat, text: session.roster?.[speakerSeat - 1].control.speech ?? this.speechText, revision: session.revision },
      timing: { remainingMs: running ? Math.max(0, session.dueAt - this.now()) + this.budget(session) - this.waitTime(session) + nightExtra : 0 },
      day: view.night, period: view.period, phaseLabel: !running ? (finished ? '对局结束' : '对局异常停止') : room.phase!.label,
      phaseTransition: running && view.period === 'day' && ['nominations', 'vote'].includes(room.phase?.key ?? '')
        ? { kind: room.phase!.key === 'nominations' ? 'campaign' as const : 'exile-vote' as const, id: String(room.phaseInstance) } : null,
      actor: running && view.period === 'day' && room.phase?.mode === 'sequential' ? eligibleActors(room)[0] ?? null : null,
      progress: vote ? { submitted: room.decisions.length, eligible: room.phase!.actors.length } : null,
      sheriff: view.sheriff, players: view.players.map(player => {
        const robot = session.roster?.[player.seat - 1];
        if (!robot) return player;
        const { userId, nickname, gender, avatar, portrait } = robot;
        return { ...player, user: structuredClone({ userId, nickname, gender, avatar, portrait }) };
      }), events, result: publicView.result,
      ...(finished ? {
        roles: revealed!.players.map(({ seat, role }) => ({ seat, role })),
        replay: [...session.phases.entries()].map(([instance, phase]) => ({ ...phase,
          events: visibleEvents.filter(event => event.phaseInstance === instance).map(({ sequence, type, data }) => ({ sequence, ...phase, type, data })),
        })).filter(frame => frame.events.length).reduce<{ day: number; period: 'day' | 'night'; events: typeof events }[]>((frames, frame) => {
          const last = frames.at(-1);
          if (last?.day === frame.day && last.period === frame.period) last.events.push(...frame.events);
          else frames.push(frame);
          return frames;
        }, []),
      } : {}),
    };
  }
}
