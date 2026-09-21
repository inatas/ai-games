import { randomUUID } from 'node:crypto';
import type { Json } from '@game-ai/core';
import { acceptDecision, createRoom, eligibleActors, occupySeat, spectatorView, type Room, type RoomDefinition } from '@game-ai/turn-based';
import { werewolfDefinition } from './definition.ts';
import type { GameView } from './views.ts';
import { nightActionSchema, type Match } from './match.ts';

interface Session {
  room: Room;
  definition: RoomDefinition;
  random: number;
  strategy: 'fixed' | 'random';
  lastRevision: number | null;
  revision: number;
  playing: boolean;
  remaining: number;
  clock: number;
  nightTail: boolean;
  lastControl: { revision: number; playing: boolean } | null;
  touched: number;
  phases: Map<number, { day: number; period: 'day' | 'night' }>;
}
interface Schema { const?: Json; enum?: Json[]; oneOf?: Schema[]; type?: string; properties?: Record<string, Schema> }

/** Local demonstration only: private state and deterministic decisions never leave this host. */
export class DemoRooms {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;
  private readonly speechText: string;

  constructor(options: { now?: () => number; speechText?: string } = {}) {
    this.now = options.now ?? Date.now;
    this.speechText = options.speechText ?? '我是狼人杀玩家';
    if (!this.speechText.trim() || [...this.speechText].length > 300) throw new Error('INVALID_DEMO_SPEECH');
  }

  private budget(session: Session): number {
    const key = session.room.phase?.key;
    if (key === 'wolves') return session.nightTail ? 30_000 : 60_000;
    if (key === 'witch') return 30_000;
    if (key === 'speech' || key === 'election-speech') return 150_000;
    if (key === 'pk' || key === 'election-pk' || key === 'last-words') return 90_000;
    if (key === 'direction' || key === 'badge-transfer' || key === 'election-withdrawal') return 20_000;
    return 30_000;
  }

  private waitTime(session: Session): number {
    return ['wolves', 'witch'].includes(session.room.phase?.key ?? '') ? this.budget(session) : 3_000;
  }

  create(seed: number, strategy: 'fixed' | 'random') {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !['fixed', 'random'].includes(strategy)) throw new Error('INVALID_DEMO_OPTIONS');
    for (const [id, session] of this.sessions) if (this.now() - session.touched > 3_600_000) this.sessions.delete(id);
    if (this.sessions.size >= 100) throw new Error('DEMO_CAPACITY');
    const definition = werewolfDefinition({ seed, sheriff: 'double' });
    const id = randomUUID();
    let room = createRoom(id, id, definition);
    for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
      seat, name: `${seat}号玩家`, modelProfile: 'fixed-text-demo', scopeId: `seat-${seat}`, interruptScopeId: `interrupt-${seat}`,
    }, definition);
    const session: Session = { room, definition, random: (seed ^ 20260963) >>> 0, strategy, lastRevision: null,
      revision: 0, playing: false, remaining: 60_000, clock: this.now(), nightTail: false, lastControl: null,
      touched: this.now(), phases: new Map() };
    session.phases.set(room.phaseInstance, { day: 1, period: 'night' });
    this.sessions.set(id, session);
    return this.snapshot(session);
  }

  private session(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || this.now() - session.touched > 3_600_000) { this.sessions.delete(id); throw new Error('DEMO_NOT_FOUND'); }
    session.touched = this.now();
    return session;
  }

  private tick(session: Session, advance: boolean): void {
    const now = this.now();
    if (session.playing) session.remaining = Math.max(0, session.remaining - Math.max(0, now - session.clock));
    session.clock = now;
    // Show every public transition, even when the browser was in the background.
    if (advance && session.playing && session.remaining === 0) this.advance(session);
  }

  get(id: string) {
    const session = this.session(id);
    this.tick(session, true);
    return this.snapshot(session);
  }

  control(id: string, revision: number, playing: boolean) {
    const session = this.session(id);
    if (session.lastControl?.revision === revision && session.lastControl.playing === playing) return this.snapshot(session);
    if (revision !== session.revision) throw new Error('REVISION_CONFLICT');
    this.tick(session, false);
    session.playing = playing && session.room.status === 'running';
    session.revision++;
    session.lastControl = { revision, playing };
    return this.snapshot(session);
  }

  step(id: string, revision: number) {
    const session = this.session(id);
    if (revision === session.lastRevision) return this.snapshot(session);
    if (revision !== session.revision) throw new Error('REVISION_CONFLICT');
    this.advance(session);
    session.lastRevision = revision;
    session.playing = false;
    return this.snapshot(session);
  }

  private advance(session: Session): void {
    const room = session.room;
    if (room.status !== 'running' || !room.phase) return;
    const match = room.state as unknown as Match;
    // Preserve the same public night duration when the witch is dead.
    if (match.stage === 'wolves' && !session.nightTail && !match.game.players.some(p => p.alive && p.role === 'witch')) {
      session.nightTail = true;
      session.remaining = 30_000;
      session.clock = this.now();
      session.revision++;
      return;
    }
    let random = session.random;
    const choose = (count: number) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return session.strategy === 'fixed' ? 0 : Math.floor(random / 0x100000000 * count);
    };
    const sample = (schema: Schema): Json => {
      if (schema.const !== undefined) return schema.const;
      if (schema.oneOf) return sample(schema.oneOf[choose(schema.oneOf.length)]);
      if (schema.enum) { const options = schema.enum.filter(item => item !== null); return options.length ? options[choose(options.length)] : null; }
      if (schema.type === 'string') return this.speechText;
      if (schema.type === 'boolean') return choose(2) === 0;
      if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, sample(value)]));
      throw new Error('UNSUPPORTED_DEMO_ACTION');
    };
    let next = room;
    const actors = room.phase.mode === 'sealed' ? eligibleActors(room) : eligibleActors(room).slice(0, 1);
    for (const actor of actors) {
      const schema = match.stage === 'wolves' ? nightActionSchema(match, actor) : room.phase.schema;
      next = acceptDecision(next, room.phaseInstance, actor, sample(schema as Schema), session.definition);
    }
    // Commit random state and game together only after the pure transition succeeds.
    session.room = next;
    session.random = random;
    session.nightTail = false;
    session.revision++;
    session.remaining = this.waitTime(session);
    session.clock = this.now();
    if (next.status !== 'running') { session.playing = false; session.remaining = 0; }
    const view = spectatorView(next, session.definition).state as unknown as GameView;
    if (!session.phases.has(next.phaseInstance)) session.phases.set(next.phaseInstance, { day: view.night, period: view.period });
  }

  private snapshot(session: Session) {
    const { room, definition } = session;
    const publicView = spectatorView(room, definition);
    const view = publicView.state as unknown as GameView;
    const vote = view.period === 'day' && room.phase?.key === 'vote';
    const visibleEvents = publicView.events.filter(event => !['decision', 'interrupt'].includes(event.type));
    const events = visibleEvents.map(({ type, data }) => ({ type, data }));
    const finished = room.status === 'finished';
    const speeches = visibleEvents.filter(event => ['speech', 'sheriff-speech', 'last-words'].includes(event.type)).map(event => {
      const data = event.data as { seat: number; text: string; runoff?: boolean };
      return { sequence: event.sequence, day: session.phases.get(event.phaseInstance)!.day,
        phase: event.type === 'last-words' ? '遗言' : event.type === 'sheriff-speech' ? (data.runoff ? '警长PK发言' : '上警发言') : (data.runoff ? '放逐PK发言' : '放逐发言'),
        seat: data.seat, text: data.text };
    });
    const nightExtra = room.phase?.key === 'wolves' && !session.nightTail ? 30_000 : 0;
    const revealed = publicView.replay as unknown as { players: { seat: number; role: string }[] } | undefined;
    return {
      id: room.id, revision: session.revision, status: room.status,
      playing: session.playing, speeches,
      timing: { remainingMs: finished ? 0 : session.remaining + this.budget(session) - this.waitTime(session) + nightExtra },
      day: view.night, period: view.period, phaseLabel: room.phase?.label ?? (finished ? '对局结束' : '演示已停止'),
      actor: view.period === 'day' && room.phase?.mode === 'sequential' ? eligibleActors(room)[0] ?? null : null,
      progress: vote ? { submitted: room.decisions.length, eligible: room.phase!.actors.length } : null,
      sheriff: view.sheriff, players: view.players, events, result: publicView.result,
      ...(finished ? {
        roles: revealed!.players.map(({ seat, role }) => ({ seat, role })),
        replay: [...session.phases.entries()].map(([instance, phase]) => ({ ...phase,
          events: visibleEvents.filter(event => event.phaseInstance === instance).map(({ type, data }) => ({ type, data })),
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
