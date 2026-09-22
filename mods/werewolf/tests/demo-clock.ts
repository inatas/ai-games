import { DemoRooms } from '../src/demo.ts';

export function demoClock(speechText?: string) {
  let now = 0;
  const rooms = new DemoRooms({ now: () => now, speechText });
  return {
    rooms,
    advance(id: string) {
      const game = rooms.get(id);
      now += game.period === 'night' ? game.nightSegment === 'shared' ? 60_000 : 30_000 : 3_000;
      rooms.tick();
      return rooms.get(id);
    },
    finish(id: string) {
      let game = rooms.get(id);
      for (let i = 0; game.status === 'running' && i < 600; i++) {
        now += 30_000;
        rooms.tick();
        game = rooms.get(id);
      }
      return game;
    },
  };
}

