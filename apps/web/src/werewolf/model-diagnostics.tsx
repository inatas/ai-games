import { useEffect, useState } from 'react';
import { modelTestHeaders, modelTestToken, setModelTestToken } from './model-test-auth.ts';
import './model-diagnostics.css';

type Call = { sequence: number; occurredAt: string; requestId: string; seatNo: number | null;
  phase: string | null; profile: string | null; attempt: number; status: string; latencyMs: number | null;
  errorCode: string | null; httpStatus: number | null; inputTokens: number | null; outputTokens: number | null;
  cacheHitTokens: number | null; cacheMissTokens: number | null; schemaValid: boolean | null;
  gameCommitted: boolean | null; promptLayoutVersion: number | null };
type Usage = { inputTokens: number; outputTokens: number; reportedCalls: number; unreportedCalls: number;
  cacheHitTokens: number; cacheMissTokens: number; cacheReportedCalls: number;
  cacheUnreportedCalls: number; cacheRate: number | null;
  cacheBySeat: { key: string; hitTokens: number; missTokens: number; rate: number | null; calls: number }[];
  cacheByPhase: { key: string; hitTokens: number; missTokens: number; rate: number | null; calls: number }[] };

const statusNames: Record<string, string> = { started: '进行中', succeeded: '供应商已返回', failed: 'API 调用失败',
  unknown: '结果未知', 'not-sent': '请求未发出' };

export function ModelDiagnostics({ roomId }: { roomId: string }) {
  const [tokenInput, setTokenInput] = useState(modelTestToken);
  const [unlocked, setUnlocked] = useState(!!modelTestToken());
  const [calls, setCalls] = useState<Call[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [after, setAfter] = useState(0);
  const [seat, setSeat] = useState('');
  const [result, setResult] = useState('');
  const [phase, setPhase] = useState('');
  const [detail, setDetail] = useState<unknown>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!unlocked) return;
    let stopped = false;
    async function load() {
      try {
        const query = new URLSearchParams({ after: String(after), limit: '100' });
        if (seat) query.set('seat', seat);
        if (result) query.set('result', result);
        const headers = modelTestHeaders();
        const [callResponse, usageResponse] = await Promise.all([
          fetch(`/api/werewolf/model/${roomId}/model-calls?${query}`, { headers }),
          fetch(`/api/werewolf/model/${roomId}/usage`, { headers }),
        ]);
        if (!callResponse.ok || !usageResponse.ok) throw new Error('诊断查询失败，请检查测试口令和模型服务');
        const [nextCalls, nextUsage] = await Promise.all([callResponse.json() as Promise<Call[]>, usageResponse.json() as Promise<Usage>]);
        if (!stopped) { setCalls(nextCalls); setUsage(nextUsage); setError(''); }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : '诊断查询失败'); }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [roomId, unlocked, after, seat, result]);
  async function inspect(call: Call) {
    setError('');
    try {
      const response = await fetch(`/api/werewolf/model/${roomId}/model-calls/${call.requestId}/${call.attempt}`,
        { headers: modelTestHeaders() });
      if (!response.ok) throw new Error('调用详情读取失败');
      setDetail(await response.json());
    } catch (cause) { setError(cause instanceof Error ? cause.message : '调用详情读取失败'); }
  }
  const phases = [...new Set(calls.map(call => call.phase).filter((value): value is string => !!value))].sort();
  const shown = phase ? calls.filter(call => call.phase === phase) : calls;
  return <section className="ww-diagnostics">
    {!unlocked && <div className="ww-diagnostic-login"><p>输入服务端测试口令以查看调用日志和私密上下文。</p>
      <input type="password" autoComplete="off" value={tokenInput} onChange={event => setTokenInput(event.target.value)} />
      <button onClick={() => { setModelTestToken(tokenInput); setUnlocked(!!modelTestToken()); }}>查看诊断</button></div>}
    {unlocked && <>
      <p className="ww-diagnostic-room">房间 ID：<code>{roomId}</code> <button onClick={() => void navigator.clipboard.writeText(roomId)}>复制</button></p>
      {usage && <div className="ww-diagnostic-totals">
        <span>输入 {usage.inputTokens.toLocaleString()} token</span><span>输出 {usage.outputTokens.toLocaleString()} token</span>
        <span>缓存命中 {usage.cacheRate === null ? '未知' : `${(usage.cacheRate * 100).toFixed(1)}%`}</span>
        <span>命中 {usage.cacheHitTokens.toLocaleString()} / 未命中 {usage.cacheMissTokens.toLocaleString()}</span>
        <span>未报告缓存 {usage.cacheUnreportedCalls} 次</span>
      </div>}
      {usage && <details><summary>按座位和阶段查看缓存命中</summary><div className="ww-diagnostic-groups">
        <div><b>座位</b>{usage.cacheBySeat.map(group => <p key={group.key}>{group.key}号：{group.rate === null ? '未知' : `${(group.rate*100).toFixed(1)}%`}
          <small>（命中 {group.hitTokens} / 未命中 {group.missTokens}，{group.calls} 次）</small></p>)}</div>
        <div><b>阶段</b>{usage.cacheByPhase.map(group => <p key={group.key}>{group.key}：{group.rate === null ? '未知' : `${(group.rate*100).toFixed(1)}%`}
          <small>（命中 {group.hitTokens} / 未命中 {group.missTokens}，{group.calls} 次）</small></p>)}</div>
      </div></details>}
      <div className="ww-diagnostic-filters"><label>座位 <select value={seat} onChange={event => { setSeat(event.target.value); setAfter(0); }}>
        <option value="">全部</option>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index+1}>{index+1}号</option>)}</select></label>
        <label>调用状态 <select value={result} onChange={event => { setResult(event.target.value); setAfter(0); }}>
          <option value="">全部</option>{Object.entries(statusNames).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        <label>阶段 <select value={phase} onChange={event => setPhase(event.target.value)}>
          <option value="">全部</option>{phases.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <div className="ww-diagnostic-list">{shown.length === 0 && <p>当前筛选没有调用记录。</p>}
        {shown.map(call => <button key={`${call.requestId}:${call.attempt}:${call.sequence}`} onClick={() => void inspect(call)}>
          <b>{call.seatNo ?? '—'}号 · {call.phase ?? '未知阶段'} · {statusNames[call.status] ?? call.status}</b>
          <small>{new Date(call.occurredAt).toLocaleString()} · 第 {call.attempt} 次 · {call.profile ?? '未记录'}</small>
          <small>{call.errorCode ? `错误 ${call.errorCode}` : call.schemaValid === false ? '返回内容不符合 Schema' :
            call.gameCommitted === false ? '裁判未接受' : call.gameCommitted === true ? '裁判已接受' : ''}
            {call.httpStatus ? ` · HTTP ${call.httpStatus}` : ''}{call.latencyMs === null ? '' : ` · ${call.latencyMs} ms`}</small>
          <small>输入 {call.inputTokens ?? '未知'} / 输出 {call.outputTokens ?? '未知'} · 缓存 {call.cacheHitTokens ?? '未知'} / {call.cacheMissTokens ?? '未知'}</small>
        </button>)}</div>
      <div className="ww-diagnostic-pages"><button disabled={after === 0} onClick={() => setAfter(0)}>第一页</button>
        <button disabled={calls.length < 100} onClick={() => setAfter(calls.at(-1)!.sequence)}>下一页</button></div>
      {detail !== null && <div className="ww-diagnostic-detail"><h3>私密调用详情</h3><button onClick={() => setDetail(null)}>收起详情</button>
        <pre>{JSON.stringify(detail, null, 2)}</pre></div>}
    </>}
    {error && <p role="alert" className="ww-diagnostic-error">{error}</p>}
  </section>;
}
