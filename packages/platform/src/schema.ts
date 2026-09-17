import type { Transaction } from '@game-ai/core';
export async function migratePlatform(tx: Transaction) {
  await tx.query(`
    CREATE TABLE IF NOT EXISTS platform_wallets (
      id text PRIMARY KEY, owner_kind text NOT NULL CHECK(owner_kind IN ('account','character')),
      owner_id uuid NOT NULL, realm_id text NOT NULL, currency text NOT NULL,
      balance integer NOT NULL DEFAULT 0 CHECK(balance>=0),
      CHECK((owner_kind='account' AND realm_id='') OR (owner_kind='character' AND realm_id<>'')),
      UNIQUE(owner_kind,owner_id,realm_id,currency));
    CREATE TABLE IF NOT EXISTS platform_wallet_entries (
      wallet_id text REFERENCES platform_wallets(id), request_id text, delta integer NOT NULL CHECK(delta<>0),
      reason text NOT NULL, balance_after integer NOT NULL CHECK(balance_after>=0),
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(wallet_id,request_id));
  `);
  await tx.query(`
    CREATE TABLE IF NOT EXISTS mud_realms (
      id text PRIMARY KEY, mod_id text NOT NULL, mod_version text NOT NULL,
      content_version text NOT NULL, worldview_version text NOT NULL, revision integer NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS mud_characters (
      scope_id uuid PRIMARY KEY REFERENCES fw_scopes(id), realm_id text NOT NULL REFERENCES mud_realms(id),
      name text NOT NULL, active boolean NOT NULL DEFAULT true);
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
`);
  await tx.query(`
    CREATE TABLE IF NOT EXISTS platform_events (
      id uuid PRIMARY KEY, realm_id text NOT NULL REFERENCES mud_realms(id), type text NOT NULL,
      actor jsonb NOT NULL, request_id uuid NOT NULL, causation_id uuid REFERENCES platform_events(id),
      chain_depth integer NOT NULL CHECK(chain_depth BETWEEN 0 AND 4), content_version text NOT NULL,
      payload jsonb NOT NULL, created_at bigint NOT NULL, hash text NOT NULL);
    CREATE TABLE IF NOT EXISTS platform_event_deliveries (
      id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES platform_events(id), consumer_id text NOT NULL,
      recipient_kind text NOT NULL, recipient_id text NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
      lease_until bigint, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
      next_attempt_at bigint NOT NULL, error_code text,
      UNIQUE(event_id,consumer_id,recipient_kind,recipient_id));
    CREATE INDEX IF NOT EXISTS platform_delivery_due ON platform_event_deliveries(next_attempt_at) WHERE status IN ('pending','processing');
  `);
}
