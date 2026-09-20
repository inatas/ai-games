import type { Transaction } from '@game-ai/core';

/** Invoke after the common store migration. No MUD or platform migration is needed. */
export async function migrateTurnBased(tx: Transaction): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(7310259)');
  await tx.query(`
    CREATE TABLE IF NOT EXISTS tb_rooms (
      id uuid PRIMARY KEY,
      run_key text NOT NULL UNIQUE,
      document jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tb_seats (
      room_id uuid NOT NULL REFERENCES tb_rooms(id),
      seat integer NOT NULL CHECK (seat > 0),
      scope_id uuid NOT NULL UNIQUE REFERENCES fw_scopes(id),
      PRIMARY KEY (room_id, seat)
    );
  `);
}
