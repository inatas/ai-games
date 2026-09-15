import React, { useEffect, useState } from 'react';

export type UserSession = { userId: string; username: string; currentScopeId: string };
export class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
export async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, body.detail ?? body.code);
  return body;
}
export function useIdentity() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function restore() {
    setLoading(true); setError('');
    try { setSession(await api('/api/auth/session')); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setSession(null); else setError('连接失败，请重试。'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void restore(); }, []);
  async function login(username: string, password: string) {
    const user = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setSession(user); setError('');
  }
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    setSession(null);
  }
  return { session, loading, error, restore, login, logout };
}
export function LoginPanel({ login, legacy = false }: { login(username: string, password: string): Promise<void>; legacy?: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <section className="welcome"><h2>登录并继续你的旅程</h2>
    <p>账号不存在时将自动创建。默认记住登录，游戏进度长期保存。</p>
    {legacy && <p>此浏览器有旧游客档案，暂未关联账号；旧数据仍然保留。</p>}
    <form className="login-form" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); void login(username, password).catch(e => {
      setError(e instanceof ApiError && e.code === 'RATE_LIMITED' ? '尝试过于频繁，请稍后再试。' : e instanceof ApiError && e.status === 401 ? '用户名或密码不正确。' : '登录失败，请检查输入和网络。');
    }).finally(() => { setBusy(false); setPassword(''); }); }}>
      <label>用户名<input required autoComplete="username" pattern="[A-Za-z0-9_]{3,32}" minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} disabled={busy}/></label>
      <small>3–32位字母、数字或下划线，不区分大小写。</small>
      <label>密码<input required type="password" autoComplete="current-password" minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/></label>
      <small>8–128个字符。已有账号请填写原密码。</small>
      <button className="primary" disabled={busy}>{busy ? '正在登录…' : '登录 / 自动创建账号'}</button>
    </form>{error && <p role="alert">{error}</p>}
  </section>;
}
