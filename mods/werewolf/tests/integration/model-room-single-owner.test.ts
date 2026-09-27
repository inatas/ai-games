import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { startTestDatabase } from '../../../../tests/support/database.ts';
import { WerewolfModelService } from '../../server/werewolf-model-service.ts';

let db: Awaited<ReturnType<typeof startTestDatabase>>;
const services: WerewolfModelService[] = [];
const envNames = ['MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_API_KEY', 'MODEL_PROTOCOL', 'JEV_SHADOW_ENABLED'] as const;
const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]));

before(async () => {
  Object.assign(process.env, { MODEL_BASE_URL: 'https://api.deepseek.com', MODEL_NAME: 'test-model',
    MODEL_API_KEY: 'test-only', MODEL_PROTOCOL: 'deepseek', JEV_SHADOW_ENABLED: 'false' });
  db = await startTestDatabase();
});

after(async () => {
  await Promise.all(services.map(service => service.close()));
  for (const name of envNames) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  await db?.stop();
});

function service(onLost?: () => void) {
  const instance = new WerewolfModelService(db.store, onLost);
  services.push(instance);
  return instance;
}

test('SO-01/04/05: second host cannot start or recover while first host owns model rooms', async () => {
  const first = service();
  const second = service();
  await first.migrate();
  await assert.rejects(() => second.migrate(), /MODEL_ROOM_OWNER_EXISTS/);
  await assert.rejects(() => second.recover(), /MODEL_ROOM_OWNER_LOST/);
  await first.close();
  await second.migrate();
  await second.recover();
  await second.close();
});

test('SO-02: broken owner connection stops the old host and allows takeover', async () => {
  let lost = 0;
  const first = service(() => { lost++; });
  await first.migrate();
  const lock = await db.store.pool.query(`SELECT pid FROM pg_locks
    WHERE locktype='advisory' AND granted AND classid=$1::oid AND objid=$2::oid AND objsubid=2
      AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`,
    [0x57455245, 0x574F4C46]);
  assert.equal(lock.rows.length, 1);
  await db.store.pool.query('SELECT pg_terminate_backend($1)', [lock.rows[0].pid]);
  for (let attempt = 0; attempt < 50 && first.hasOwnership(); attempt++)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(first.hasOwnership(), false);
  assert.equal(lost, 1);
  await assert.rejects(() => first.recover(), /MODEL_ROOM_OWNER_LOST/);
  const second = service();
  await second.migrate();
  await second.recover();
  await second.close();
});

test('SO-05: concurrent hosts cannot both acquire the same database lock', async () => {
  const first = service();
  const second = service();
  const outcomes = await Promise.allSettled([first.migrate(), second.migrate()]);
  assert.deepEqual(outcomes.map(outcome => outcome.status).sort(), ['fulfilled', 'rejected']);
  const winner = outcomes[0].status === 'fulfilled' ? first : second;
  const loser = winner === first ? second : first;
  await assert.rejects(() => loser.recover(), /MODEL_ROOM_OWNER_LOST/);
  await winner.close();
  await loser.migrate();
  await loser.close();
});

test('SO-03: the same advisory key can be held independently in another database', async () => {
  const owner = service();
  await owner.migrate();
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/template1';
  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT pg_try_advisory_lock($1::int,$2::int) AS acquired',
        [0x57455245, 0x574F4C46]);
      assert.equal(result.rows[0].acquired, true);
    } finally { client.release(true); }
  } finally {
    await pool.end();
    await owner.close();
  }
});
