import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoRooms } from '../src/demo.ts';
import { buildWerewolfDemo } from '../server/werewolf-demo.ts';

test('script speech stays on the same seat after three seconds and advances only at its deadline', () => {
  let now = 0;
  const rooms = new DemoRooms({ now: () => now });
  const created = rooms.create(42, 'random');
  now = 93_000;
  rooms.tick();
  const speaking = rooms.get(created.id);
  assert.ok(speaking.speakerSeat);
  assert.equal(speaking.timing.remainingMs, 120_000);
  now += 3_000;
  rooms.tick();
  assert.equal(rooms.get(created.id).revision, speaking.revision);
  now += 116_999;
  rooms.tick();
  assert.equal(rooms.get(created.id).revision, speaking.revision);
  now += 1;
  rooms.tick();
  assert.ok(rooms.get(created.id).revision > speaking.revision);
});

test('V4-01/02/03: host clock runs without reads; GET is read-only; only speakers have avatars', () => {
  let now = 0;
  const rooms = new DemoRooms({ now: () => now });
  let game = rooms.create(42, 'random');
  assert.equal(game.speakerSeat, null);
  assert.equal(game.nightSegment, 'shared');
  now = 60_000;
  assert.equal(rooms.get(game.id).revision, 0);
  rooms.tick();
  game = rooms.get(game.id);
  assert.equal(game.nightSegment, 'medicine');
  assert.equal(game.timing.remainingMs, 30_000);
  rooms.tick();
  assert.equal(rooms.get(game.id).revision, game.revision);
  now = 90_000;
  rooms.tick();
  game = rooms.get(game.id);
  assert.equal(game.phaseLabel, '上警报名');
  assert.equal(game.speakerSeat, null);
  assert.equal(game.events.some(e => e.type === 'night-deaths'), false);
  now += 3_000;
  rooms.tick();
  game = rooms.get(game.id);
  assert.equal(game.speakerSeat, game.actor);
  assert.ok(game.speakerSeat);
  // No reads are needed to advance; keep gaps below the one-hour session expiry.
  for (let i = 0; i < 12 && game.status === 'running'; i++) {
    now += 900_000;
    rooms.tick();
    game = rooms.get(game.id);
  }
  assert.equal(game.status, 'finished');
  assert.equal(game.speakerSeat, null);
  assert.ok(game.speeches.every(s => s.text === '我是狼人杀玩家'));
  assert.ok(game.events.every(e => e.sequence > 0 && e.day > 0));
  assert.ok(game.events.every((e, index) => e.sequence === index + 1));
  assert.ok(game.events.every(e => !['inspection', 'medicine', 'wolf-choices'].includes(e.type)));
  assert.ok(game.replay?.some(frame => frame.events.some(e => e.type === 'wolf-choices')));
  assert.ok(game.events.findIndex(e => e.type === 'night-deaths') > game.events.findIndex(e => e.type === 'sheriff-result'));
  const result = game;
  rooms.tick();
  assert.deepEqual(rooms.get(game.id), result);
});

test('V4-02: removed controls cannot pause/step a live HTTP game', async t => {
  const app = await buildWerewolfDemo();
  t.after(() => app.close());
  const game = (await app.inject({method:'POST', url:'/api/werewolf/demo',payload:{seed:42,strategy:'random'}})).json();
  for (const path of ['control', 'step']) {
    assert.equal((await app.inject({method:'POST',url:`/api/werewolf/demo/${game.id}/${path}`,payload:{revision:0,playing:false}})).statusCode, 404);
  }
});

test('V4-04: initial/suppressed/duplicate snapshots do not replay old announcements', async () => {
  const { nextPresentation } = await import('../web/presentation.ts');
  const rooms = new DemoRooms({now:()=>0});
  const base = rooms.create(42, 'fixed');
  let update = nextPresentation(null, base, false);
  assert.deepEqual(update.items.map(i => i.kind), ['night']);
  const day = {...base, revision:2, period:'day' as const, events:[]};
  update = nextPresentation(update.cursor, day, false);
  assert.deepEqual(update.items.map(i => i.kind), ['day']);
  const announcement = {...day, events:[{sequence:8, day:1, period:'day' as const,type:'night-deaths',data:{seats:[3,5]}}]};
  update = nextPresentation(update.cursor, announcement, false);
  assert.deepEqual(update.items.map(i => i.kind), ['deaths']);
  assert.deepEqual(update.items[0].seats, [3,5]);
  assert.equal(nextPresentation(update.cursor, announcement, false).items.length, 0);
  assert.equal(nextPresentation(null, announcement, false).items.length, 0);
  assert.equal(nextPresentation(null, announcement, true).items.length, 0);
});

test('first-day peaceful-night announcement survives batched revisions and an open history panel', async () => {
  const { nextPresentation } = await import('../web/presentation.ts');
  const rooms = new DemoRooms({now:()=>0});
  const base = rooms.create(42, 'fixed');
  const before = {...base, revision:3, period:'day' as const, events:[]};
  const announced: typeof base = {...before, revision:12, events:[
    {sequence:1, day:1, period:'day' as const, type:'sheriff-result', data:{seat:5}},
    {sequence:2, day:1, period:'day' as const, type:'night-deaths', data:{seats:[]}},
  ]};
  const initial = nextPresentation(null, before, false);
  const batched = nextPresentation(initial.cursor, announced, false);
  assert.deepEqual(batched.items.map(item => [item.kind, item.seats]), [['deaths', []]]);
  const hidden = nextPresentation(initial.cursor, announced, true);
  assert.equal(hidden.items.length, 0);
  const resumed = nextPresentation(hidden.cursor, announced, false);
  assert.deepEqual(resumed.items.map(item => [item.kind, item.seats]), [['deaths', []]]);
  assert.equal(nextPresentation(resumed.cursor, announced, false).items.length, 0);
  assert.equal(nextPresentation(null, announced, false).items.length, 0);
  const tomorrow = {...announced, day:2, revision:13, events:announced.events.map(event => ({...event, day:1}))};
  assert.equal(nextPresentation(hidden.cursor, tomorrow, false).items.some(item => item.kind === 'deaths'), false);
  assert.equal(nextPresentation(hidden.cursor, {...announced, status:'finished' as const}, false).items.length, 0);
});

test('V4-05: vote summary groups voters without losing abstentions or sheriff weight', async () => {
  const { summarizeVotes } = await import('../web/presentation.ts');
  const result = summarizeVotes({
    ballots:[{seat:1,target:6,kind:'vote'},{seat:2,target:6,kind:'vote'},{seat:6,target:5,kind:'vote'},{seat:10,target:null,kind:'abstain'},{seat:11,target:null,kind:'missing'}],
    totals:[{seat:6,votes:2.5},{seat:5,votes:1}],winner:6,tied:[],sheriff:1,
  });
  assert.deepEqual(result.map(row=>[row.target,row.voters,row.total]), [[6,[1,2],2.5],[5,[6],1],['abstain',[10],0],['missing',[11],0]]);
});

