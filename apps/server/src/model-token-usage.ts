import { HarnessError } from '@game-ai/core';
import type { PostgresStore } from '@game-ai/storage';

export interface RoomTokenUsage {
  roomId: string;
  inputTokens: number;
  outputTokens: number;
  reportedCalls: number;
  unreportedCalls: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheReportedCalls: number;
  cacheUnreportedCalls: number;
  cacheRate: number | null;
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
    ), cache_checked AS (
      SELECT usage, reported,
        CASE WHEN reported
          AND jsonb_typeof(usage->'promptCacheHitTokens')='number'
          AND jsonb_typeof(usage->'promptCacheMissTokens')='number'
          AND (usage->>'promptCacheHitTokens') ~ '^(0|[1-9][0-9]*)$'
          AND (usage->>'promptCacheMissTokens') ~ '^(0|[1-9][0-9]*)$'
          AND length(usage->>'promptCacheHitTokens') <= 16
          AND length(usage->>'promptCacheMissTokens') <= 16
        THEN (usage->>'promptCacheHitTokens')::numeric <= 9007199254740991
          AND (usage->>'promptCacheMissTokens')::numeric <= 9007199254740991
          AND (usage->>'promptCacheHitTokens')::numeric + (usage->>'promptCacheMissTokens')::numeric = (usage->>'inputTokens')::numeric
        ELSE false END AS cache_reported
      FROM validated
    )
    SELECT COALESCE(SUM(CASE WHEN reported THEN (usage->>'inputTokens')::numeric ELSE 0 END),0)::text AS input_tokens,
      COALESCE(SUM(CASE WHEN reported THEN (usage->>'outputTokens')::numeric ELSE 0 END),0)::text AS output_tokens,
      COUNT(*) FILTER (WHERE reported)::text AS reported_calls,
      COUNT(*) FILTER (WHERE NOT reported)::text AS unreported_calls,
      COALESCE(SUM(CASE WHEN cache_reported THEN (usage->>'promptCacheHitTokens')::numeric ELSE 0 END),0)::text AS cache_hit_tokens,
      COALESCE(SUM(CASE WHEN cache_reported THEN (usage->>'promptCacheMissTokens')::numeric ELSE 0 END),0)::text AS cache_miss_tokens,
      COUNT(*) FILTER (WHERE cache_reported)::text AS cache_reported_calls,
      COUNT(*) FILTER (WHERE NOT cache_reported)::text AS cache_unreported_calls
    FROM cache_checked`, [roomId]);
  const row = rows[0];
  const cacheHitTokens = safeCount(row.cache_hit_tokens);
  const cacheMissTokens = safeCount(row.cache_miss_tokens);
  return {
    roomId,
    inputTokens: safeCount(row.input_tokens),
    outputTokens: safeCount(row.output_tokens),
    reportedCalls: safeCount(row.reported_calls),
    unreportedCalls: safeCount(row.unreported_calls),
    cacheHitTokens, cacheMissTokens,
    cacheReportedCalls: safeCount(row.cache_reported_calls),
    cacheUnreportedCalls: safeCount(row.cache_unreported_calls),
    cacheRate: cacheHitTokens + cacheMissTokens > 0 ? cacheHitTokens / (cacheHitTokens + cacheMissTokens) : null,
  };
}
