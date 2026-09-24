import { HarnessError } from '@game-ai/core';
import type { PostgresStore } from '@game-ai/storage';

export interface RoomTokenUsage {
  roomId: string;
  inputTokens: number;
  outputTokens: number;
  reportedCalls: number;
  unreportedCalls: number;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function safeCount(value: string): number {
  const count = BigInt(value);
  if (count < 0n || count > MAX_SAFE) throw new HarnessError('MODEL_USAGE_OVERFLOW');
  return Number(count);
}

/** Summarize actual provider usage from completed call events, without estimating missing usage. */
export async function summarizeRoomTokenUsage(store: PostgresStore, roomId: string): Promise<RoomTokenUsage> {
  const { rows } = await store.pool.query(`WITH calls AS (
      SELECT details->'usage' AS usage
      FROM fw_event_log
      WHERE mod_id='werewolf' AND room_id=$1
        AND event_type='model.call.finished.v1' AND result='succeeded'
        AND details->>'simulated'='false'
    ), validated AS (
      SELECT usage,
        CASE WHEN jsonb_typeof(usage->'inputTokens')='number'
          AND jsonb_typeof(usage->'outputTokens')='number'
          AND (usage->>'inputTokens') ~ '^(0|[1-9][0-9]*)$'
          AND (usage->>'outputTokens') ~ '^(0|[1-9][0-9]*)$'
          AND length(usage->>'inputTokens') <= 16
          AND length(usage->>'outputTokens') <= 16
        THEN (usage->>'inputTokens')::numeric <= 9007199254740991
          AND (usage->>'outputTokens')::numeric <= 9007199254740991
        ELSE false END AS reported
      FROM calls
    )
    SELECT COALESCE(SUM(CASE WHEN reported THEN (usage->>'inputTokens')::numeric ELSE 0 END),0)::text AS input_tokens,
      COALESCE(SUM(CASE WHEN reported THEN (usage->>'outputTokens')::numeric ELSE 0 END),0)::text AS output_tokens,
      COUNT(*) FILTER (WHERE reported)::text AS reported_calls,
      COUNT(*) FILTER (WHERE NOT reported)::text AS unreported_calls
    FROM validated`, [roomId]);
  const row = rows[0];
  return {
    roomId,
    inputTokens: safeCount(row.input_tokens),
    outputTokens: safeCount(row.output_tokens),
    reportedCalls: safeCount(row.reported_calls),
    unreportedCalls: safeCount(row.unreported_calls),
  };
}
