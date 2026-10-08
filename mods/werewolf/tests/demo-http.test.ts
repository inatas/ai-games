import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { buildWerewolfDemo } from '../server/werewolf-demo.ts';
import { DemoRooms } from '../src/demo.ts';

test('UI-03/04: HTTP validates creation and rejects unknown rooms and cross-origin writes', async t => {
  const app = await buildWerewolfDemo();
  t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/api/werewolf/demo', payload: { seed: 42, strategy: 'random' } });
  assert.equal(created.statusCode, 200);
  const game = created.json();
  assert.equal(game.actor, null);
  assert.equal(game.speakerSeat, null);
  assert.equal(game.roles, undefined);
  assert.equal((await app.inject({ url:'/api/werewolf/demo/unknown' })).statusCode, 404);
  assert.equal((await app.inject({method:'POST',url:'/api/werewolf/demo',headers:{origin:'https://other.example'},payload:{seed:42,strategy:'random'}})).statusCode,403);
  for (const payload of [{seed:-1,strategy:'random'},{seed:'42',strategy:'random'},{seed:42,strategy:'random',speed:2}]) {
    assert.equal((await app.inject({method:'POST',url:'/api/werewolf/demo',payload})).statusCode,400);
  }
});

test('V4-02: host timer advances without GET and is disposed when Fastify closes', async () => {
  let now = 0;
  const rooms = new DemoRooms({now:()=>now});
  const app = await buildWerewolfDemo({rooms});
  try {
    const game = (await app.inject({method:'POST',url:'/api/werewolf/demo',payload:{seed:42,strategy:'random'}})).json();
    now = 135_000;
    await setTimeout(200);
    assert.equal(rooms.get(game.id).phaseLabel, '上警报名');
    await app.close();
    const revision = rooms.get(game.id).revision;
    now += 3000;
    await setTimeout(200);
    assert.equal(rooms.get(game.id).revision, revision);
  } finally { await app.close(); }
});

test('UI-06: demo plugin stays isolated from original routes', async t => {
  const {default:Fastify} = await import('fastify');
  const {werewolfDemoRoutes} = await import('../server/werewolf-demo.ts');
  const app = Fastify();
  t.after(()=>app.close());
  app.get('/api/existing',()=>({retained:true}));
  await app.register(werewolfDemoRoutes);
  assert.deepEqual((await app.inject({url:'/api/existing',headers:{origin:'https://unrelated.example'}})).json(),{retained:true});
  assert.equal((await app.inject({method:'POST',url:'/api/werewolf/demo',payload:{seed:42,strategy:'fixed'}})).statusCode,200);
});
