import type { Transaction } from '@game-ai/core';
export async function migrateGameSystems(tx: Transaction) {
  await tx.query(`CREATE TABLE IF NOT EXISTS game_inventory (
    scope_id uuid REFERENCES mud_characters(scope_id), item_id text,
    quantity integer NOT NULL CHECK(quantity>=0), PRIMARY KEY(scope_id,item_id))`);
  await tx.query(`
    ALTER TABLE mud_characters ADD COLUMN IF NOT EXISTS room_id text;
    CREATE INDEX IF NOT EXISTS mud_character_room ON mud_characters(realm_id,room_id) WHERE active;
    CREATE TABLE IF NOT EXISTS mud_npcs (
      realm_id text REFERENCES mud_realms(id), npc_id text, room_id text NOT NULL,
      status text NOT NULL, revision integer NOT NULL DEFAULT 0, PRIMARY KEY(realm_id,npc_id));
    CREATE TABLE IF NOT EXISTS mud_tasks (
      id uuid PRIMARY KEY, realm_id text NOT NULL REFERENCES mud_realms(id), party_id uuid NOT NULL REFERENCES mud_parties(id),
      definition_id text NOT NULL, status text NOT NULL CHECK(status IN ('active','completed','cancelled')));
    CREATE UNIQUE INDEX IF NOT EXISTS mud_active_task ON mud_tasks(party_id,definition_id) WHERE status='active';
    CREATE TABLE IF NOT EXISTS mud_participants (
      task_id uuid REFERENCES mud_tasks(id), scope_id uuid REFERENCES mud_characters(scope_id),
      eligible boolean NOT NULL DEFAULT true, contributed boolean NOT NULL DEFAULT false, PRIMARY KEY(task_id,scope_id));
    CREATE TABLE IF NOT EXISTS mud_rewards (
      task_id uuid, scope_id uuid, reward_key text, PRIMARY KEY(task_id,scope_id,reward_key),
      FOREIGN KEY(task_id,scope_id) REFERENCES mud_participants(task_id,scope_id));
  `);
  await tx.query(`CREATE TABLE IF NOT EXISTS game_npc_actors (
    realm_id text NOT NULL, npc_id text NOT NULL, scope_id uuid UNIQUE NOT NULL REFERENCES fw_scopes(id),
    enabled boolean NOT NULL DEFAULT true, actions text[] NOT NULL,
    PRIMARY KEY(realm_id,npc_id), FOREIGN KEY(realm_id,npc_id) REFERENCES mud_npcs(realm_id,npc_id));`);
  await tx.query(`CREATE TABLE IF NOT EXISTS game_npc_behaviors (
    realm_id text NOT NULL, npc_id text NOT NULL, scope_id uuid UNIQUE NOT NULL REFERENCES game_npc_actors(scope_id),
    behavior_id text NOT NULL, content_version text NOT NULL, definition jsonb NOT NULL,
    enabled boolean NOT NULL DEFAULT true, next_wake_at bigint NOT NULL,
    cursor jsonb NOT NULL DEFAULT '{}', pending jsonb, cause jsonb, revision integer NOT NULL DEFAULT 0, last_error text,
    PRIMARY KEY(realm_id,npc_id), FOREIGN KEY(realm_id,npc_id) REFERENCES game_npc_actors(realm_id,npc_id));`);
}
