import { createHash } from 'node:crypto';
import { HarnessError, type Transaction } from '@game-ai/core';

export type WalletOwner =
  | { kind: 'account'; ownerId: string; currency: string }
  | { kind: 'character'; ownerId: string; realmId: string; currency: string };

/** Trusted server API. Callers authorize the owner and reward/purchase policy first.
 * No HTTP route exposes arbitrary credits. Amounts are integer minor units.
 * Call in the same transaction as the game effect; never await a provider here.
 */
export async function postWalletEntry(tx: Transaction, owner: WalletOwner, entry: { requestId: string; delta: number; reason: string }) {
  if (!['account','character'].includes(owner.kind) || !owner.ownerId || !/^[a-zA-Z0-9_.-]{1,64}$/.test(owner.currency) ||
      !entry.requestId || entry.requestId.length > 100 || !entry.reason || entry.reason.length > 200 ||
      !Number.isInteger(entry.delta) || entry.delta === 0 || Math.abs(entry.delta) > 2147483647) throw new HarnessError('INVALID_INPUT');
  const realmId = owner.kind === 'character' ? owner.realmId : '';
  const valid = owner.kind === 'account'
    ? await tx.query('SELECT id FROM fw_users WHERE id=$1', [owner.ownerId])
    : await tx.query('SELECT scope_id FROM mud_characters WHERE scope_id=$1 AND realm_id=$2 AND active', [owner.ownerId, realmId]);
  if (!valid.rowCount) throw new HarnessError('INVALID_WALLET_OWNER', 403);
  const walletId = createHash('sha256').update(JSON.stringify([owner.kind,owner.ownerId,realmId,owner.currency])).digest('hex');
  await tx.query('INSERT INTO platform_wallets(id,owner_kind,owner_id,realm_id,currency) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [walletId,owner.kind,owner.ownerId,realmId,owner.currency]);
  const wallet = (await tx.query('SELECT balance FROM platform_wallets WHERE id=$1 FOR UPDATE', [walletId])).rows[0];
  const prior = (await tx.query('SELECT delta,reason,balance_after FROM platform_wallet_entries WHERE wallet_id=$1 AND request_id=$2', [walletId,entry.requestId])).rows[0];
  if (prior) {
    if (prior.delta !== entry.delta || prior.reason !== entry.reason) throw new HarnessError('IDEMPOTENCY_CONFLICT',409);
    return prior.balance_after as number;
  }
  const balance = Number(wallet.balance) + entry.delta;
  if (balance < 0) throw new HarnessError('INSUFFICIENT_BALANCE',409);
  if (balance > 2147483647) throw new HarnessError('BALANCE_LIMIT',409);
  await tx.query('UPDATE platform_wallets SET balance=$2 WHERE id=$1', [walletId,balance]);
  await tx.query('INSERT INTO platform_wallet_entries(wallet_id,request_id,delta,reason,balance_after) VALUES($1,$2,$3,$4,$5)', [walletId,entry.requestId,entry.delta,entry.reason,balance]);
  return balance;
}
