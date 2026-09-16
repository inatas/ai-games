import type { Transaction } from '@game-ai/core';

/** Additive shared-world tables. Game-specific attributes remain in the MOD. */
export async function migrateMud(tx: Transaction) {
  await tx.query(`
    CREATE TABLE IF NOT EXISTS mud_realms (
      id text PRIMARY KEY, mod_id text NOT NULL, mod_version text NOT NULL,
      content_version text NOT NULL, worldview_version text NOT NULL, revision integer NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS mud_characters (
      scope_id uuid PRIMARY KEY REFERENCES fw_scopes(id), realm_id text NOT NULL REFERENCES mud_realms(id),
      name text NOT NULL, room_id text NOT NULL, active boolean NOT NULL DEFAULT true);
    CREATE INDEX IF NOT EXISTS mud_character_room ON mud_characters(realm_id,room_id) WHERE active;
    CREATE TABLE IF NOT EXISTS mud_npcs (
      realm_id text REFERENCES mud_realms(id), npc_id text, room_id text NOT NULL,
      status text NOT NULL, revision integer NOT NULL DEFAULT 0, PRIMARY KEY(realm_id,npc_id));
    CREATE TABLE IF NOT EXISTS mud_presence (
      token_hash text PRIMARY KEY REFERENCES fw_sessions(token_hash) ON DELETE CASCADE,
      scope_id uuid NOT NULL REFERENCES mud_characters(scope_id), expires_at bigint NOT NULL);
    CREATE TABLE IF NOT EXISTS mud_parties (
      id uuid PRIMARY KEY, realm_id text NOT NULL REFERENCES mud_realms(id), active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS mud_members (
      scope_id uuid PRIMARY KEY REFERENCES mud_characters(scope_id), party_id uuid NOT NULL REFERENCES mud_parties(id));
    CREATE TABLE IF NOT EXISTS mud_invites (
      id uuid PRIMARY KEY, realm_id text NOT NULL REFERENCES mud_realms(id), sender uuid NOT NULL REFERENCES mud_characters(scope_id),
      recipient uuid NOT NULL REFERENCES mud_characters(scope_id), expires_at bigint NOT NULL, status text NOT NULL);
    CREATE TABLE IF NOT EXISTS mud_messages (
      id uuid PRIMARY KEY, realm_id text NOT NULL REFERENCES mud_realms(id), sender uuid NOT NULL REFERENCES mud_characters(scope_id),
      channel text NOT NULL CHECK(channel IN ('say','tell','chat')), recipient uuid REFERENCES mud_characters(scope_id),
      body text NOT NULL, created_at bigint NOT NULL);
    CREATE TABLE IF NOT EXISTS mud_receipts (
      message_id uuid REFERENCES mud_messages(id), scope_id uuid REFERENCES mud_characters(scope_id), PRIMARY KEY(message_id,scope_id));
    CREATE TABLE IF NOT EXISTS mud_writes (
      scope_id uuid REFERENCES mud_characters(scope_id), request_id uuid, hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(scope_id,request_id));
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
}
