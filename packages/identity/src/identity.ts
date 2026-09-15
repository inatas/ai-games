import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HarnessError, type HarnessStore, type Transaction } from '@game-ai/core';

const derive = promisify(scrypt);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const sessionSeconds = 30 * 86400;
export interface IdentityOptions {
  initialize(tx: Transaction, scopeId: string): Promise<void>;
  worldview?: { worldId: string; version: string };
  now?: () => number;
}
export class Identity {
  constructor(private store: HarnessStore, private options: IdentityOptions) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  private view(row: any) { return { userId: row.id as string, username: row.username as string, currentScopeId: row.current_scope_id as string }; }

  private async createScope(tx: Transaction) {
    const id = randomUUID();
    await tx.query('INSERT INTO fw_scopes(id,world_id,world_version) VALUES($1,$2,$3)', [id, this.options.worldview?.worldId ?? null, this.options.worldview?.version ?? null]);
    await this.options.initialize(tx, id);
    return id;
  }

  async login(username: string, password: string, ip: string) {
    if (typeof username !== 'string' || typeof password !== 'string') throw new HarnessError('INVALID_INPUT');
    username = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(username) || password.length < 8 || password.length > 128) throw new HarnessError('INVALID_INPUT');
    // Reserve an attempt before expensive hashing; concurrent requests cannot evade limits.
    const windowStart = Math.floor(this.now() / 900000) * 900000;
    const keys = [digest('ip:' + ip), digest('login:' + ip + ':' + username)];
    await this.store.transaction(async tx => {
      for (const [i, key] of keys.entries()) {
        const result = await tx.query(`INSERT INTO fw_login_limits(key,window_start,attempts) VALUES($1,$2,1)
          ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN fw_login_limits.window_start=$2 THEN fw_login_limits.attempts+1 ELSE 1 END,window_start=$2 RETURNING attempts`, [key, windowStart]);
        if (result.rows[0].attempts > (i === 0 ? 100 : 10)) throw new HarnessError('RATE_LIMITED', 429);
      }
    });
    const salt = randomBytes(16).toString('hex');
    const candidateHash = (await derive(password, salt, 64) as Buffer).toString('hex');
    const token = randomBytes(32).toString('hex');
    const result = await this.store.transaction(async tx => {
      // Serializes a not-yet-existing username as well as concurrent first registrations.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['identity:' + username]);
      let row = (await tx.query('SELECT * FROM fw_users WHERE username=$1 FOR UPDATE', [username])).rows[0];
      if (row) {
        const actual = await derive(password, row.password_salt, 64) as Buffer;
        if (!timingSafeEqual(actual, Buffer.from(row.password_hash, 'hex'))) throw new HarnessError('INVALID_CREDENTIALS', 401);
      } else {
        const scopeId = await this.createScope(tx);
        row = (await tx.query('INSERT INTO fw_users(id,username,password_salt,password_hash,current_scope_id) VALUES($1,$2,$3,$4,$5) RETURNING *', [randomUUID(), username, salt, candidateHash, scopeId])).rows[0];
      }
      await tx.query('INSERT INTO fw_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [digest(token), row.id, this.now() + sessionSeconds * 1000]);
      return this.view(row);
    });
    await this.store.pool.query('UPDATE fw_login_limits SET attempts=GREATEST(0,attempts-1) WHERE key=ANY($1::text[]) AND window_start=$2', [keys, windowStart]);
    return { ...result, token };
  }

  private async authenticated(tx: Transaction, token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HarnessError('UNAUTHENTICATED', 401);
    // User lock is always first; reset and action admission share this order.
    const row = (await tx.query(`SELECT u.* FROM fw_users u JOIN fw_sessions s ON s.user_id=u.id
      WHERE s.token_hash=$1 AND s.expires_at>$2 FOR UPDATE OF u`, [digest(token), this.now()])).rows[0];
    if (!row) throw new HarnessError('UNAUTHENTICATED', 401);
    const session = await tx.query('UPDATE fw_sessions SET expires_at=$3 WHERE token_hash=$1 AND expires_at>$2 RETURNING user_id', [digest(token), this.now(), this.now() + sessionSeconds * 1000]);
    if (!session.rowCount) throw new HarnessError('UNAUTHENTICATED', 401);
    return row;
  }
  async session(token: string) {
    return this.store.transaction(async tx => this.view(await this.authenticated(tx, token)));
  }
  async logout(token: string) {
    await this.store.pool.query('DELETE FROM fw_sessions WHERE token_hash=$1', [digest(token)]);
  }
  async authorizeCurrent(tx: Transaction, token: string, scopeId: string) {
    const user = await this.authenticated(tx, token);
    if (user.current_scope_id !== scopeId) throw new HarnessError('FORBIDDEN', 403);
    return this.view(user);
  }
  async reset(token: string, requestId: string, expectedScopeId: string) {
    if (!uuid.test(requestId) || !uuid.test(expectedScopeId)) throw new HarnessError('INVALID_INPUT');
    return this.store.transaction(async tx => {
      const user = await this.authenticated(tx, token);
      const previous = (await tx.query('SELECT * FROM fw_game_resets WHERE user_id=$1 AND request_id=$2', [user.id, requestId])).rows[0];
      if (previous) {
        if (previous.old_scope_id !== expectedScopeId) throw new HarnessError('IDEMPOTENCY_CONFLICT', 409);
        return { currentScopeId: previous.new_scope_id as string };
      }
      if (user.current_scope_id !== expectedScopeId) throw new HarnessError('STATE_CONFLICT', 409);
      await tx.query('SELECT id FROM fw_scopes WHERE id=$1 FOR UPDATE', [expectedScopeId]);
      await tx.query("UPDATE fw_requests SET status='failed',error=$3 WHERE scope_id=$1 AND status='processing' AND lease_expires_at<=$2", [expectedScopeId, this.now(), JSON.stringify({ code: 'PROCESSING_EXPIRED' })]);
      if ((await tx.query("SELECT 1 FROM fw_requests WHERE scope_id=$1 AND status='processing'", [expectedScopeId])).rowCount) throw new HarnessError('SCOPE_BUSY', 409);
      const scopeId = await this.createScope(tx);
      await tx.query('UPDATE fw_users SET current_scope_id=$2 WHERE id=$1', [user.id, scopeId]);
      await tx.query('INSERT INTO fw_game_resets(user_id,request_id,old_scope_id,new_scope_id) VALUES($1,$2,$3,$4)', [user.id, requestId, expectedScopeId, scopeId]);
      return { currentScopeId: scopeId };
    });
  }
}
