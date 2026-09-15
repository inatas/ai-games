import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '@game-ai/storage';

/** Tests create and remove only their own randomly named schema. No database deletion. */
export async function startTestDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required. Run docker compose --profile test run --rm tests.');
  const schema = 'harness_test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  return { connectionString, schema, store: new PostgresStore(pool), async stop() {
    await pool.end();
    if (!/^harness_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema');
    try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); }
  } };
}
