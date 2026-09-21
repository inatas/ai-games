import { randomUUID } from 'node:crypto';
import type { Json } from '@game-ai/core';
import { acceptDecision, createRoom, eligibleActors, occupySeat, spectatorView, type Room, type RoomDefinition } from '@game-ai/turn-based';
import { werewolfDefinition } from './definition.ts';
import type { GameView } from './views.ts';

interface Session {
  room: Room;
  definition: RoomDefinition;
  random: number;
  strategy: 'fixed' | 'random';
  lastRevision: number | null;
  touched: number;
  phases: Map<number, { day: number; period: 'day' | 'night' }>;
}
interface Schema { const?: Json; enum?: Json[]; oneOf?: Schema[]; type?: string; properties?: Record<string, Schema> }

/** Local demonstration only: private state and deterministic decisions never leave this host. */
export class DemoRooms {
  private readonly sessions = new Map<string, Session>();

  create(seed: number, strategy: 'fixed' | 'random') {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !['fixed', 'random'].includes(strategy)) throw new Error('INVALID_DEMO_OPTIONS');
    for (const [id, session] of this.sessions) if (Date.now() - session.touched > 3_600_000) this.sessions.delete(id);
    if (this.sessions.size >= 100) throw new Error('DEMO_CAPACITY');
    const definition = werewolfDefinition({ seed, sheriff: 'double' });
    const id = randomUUID();
    let room = createRoom(id, id, definition);
    for (let seat = 1; seat <= 12; seat++) room = occupySeat(room, {
      seat, name: `${seat}号玩家`, modelProfile: 'silent-demo', scopeId: `seat-${seat}`, interruptScopeId: `interrupt-${seat}`,
    }, definition);
    const session: Session = { room, definition, random: (seed ^ 20260963) >>> 0, strategy, lastRevision: null, touched: Date.now(), phases: new Map() };
    session.phases.set(room.phaseInstance, { day: 1, period: 'night' });
    this.sessions.set(id, session);
    return this.snapshot(session);
  }

  private session(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || Date.now() - session.touched > 3_600_000) { this.sessions.delete(id); throw new Error('DEMO_NOT_FOUND'); }
    session.touched = Date.now();
    return session;
  }

  get(id: string) { return this.snapshot(this.session(id)); }

  step(id: string, revision: number) {
    const session = this.session(id);
    if (revision === session.lastRevision) return this.snapshot(session);
    if (revision !== session.room.revision) throw new Error('REVISION_CONFLICT');
    const room = session.room;
    if (room.status !== 'running' || !room.phase) return this.snapshot(session);
    let random = session.random;
    const choose = (count: number) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return session.strategy === 'fixed' ? 0 : Math.floor(random / 0x100000000 * count);
    };
    const sample = (schema: Schema): Json => {
      if (schema.const !== undefined) return schema.const;
      if (schema.oneOf) return sample(schema.oneOf[choose(schema.oneOf.length)]);
      if (schema.enum) { const options = schema.enum.filter(item => item !== null); return options.length ? options[choose(options.length)] : null; }
      if (schema.type === 'string') return '';
      if (schema.type === 'boolean') return choose(2) === 0;
      if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, sample(value)]));
      throw new Error('UNSUPPORTED_DEMO_ACTION');
    };
    const value = sample(room.phase.schema as Schema);
    const next = acceptDecision(room, room.phaseInstance, eligibleActors(room)[0], value, session.definition);
    // Commit random state and game together only after the pure transition succeeds.
    session.lastRevision = revision;
    session.room = next;
    session.random = random;
    const view = spectatorView(next, session.definition).state as unknown as GameView;
    if (!session.phases.has(next.phaseInstance)) session.phases.set(next.phaseInstance, { day: view.night, period: view.period });
    return this.snapshot(session);
  }

  private snapshot(session: Session) {
    const { room, definition } = session;
    const publicView = spectatorView(room, definition);
    const view = publicView.state as unknown as GameView;
    const vote = view.period === 'day' && room.phase?.key === 'vote';
    const visibleEvents = publicView.events.filter(event => !['decision', 'interrupt'].includes(event.type));
    const events = visibleEvents.map(({ type, data }) => ({ type, data }));
    const finished = room.status === 'finished';
    const revealed = publicView.replay as unknown as { players: { seat: number; role: string }[] } | undefined;
    return {
      id: room.id, revision: room.revision, status: room.status,
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

