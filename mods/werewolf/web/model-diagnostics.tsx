import { useEffect, useRef, useState } from 'react';
import './model-diagnostics.css';

type Call = { sequence: number; occurredAt: string; requestId: string; seatNo: number | null;
  phase: string | null; interaction: 'SELECT' | 'SPEECH' | null; profile: string | null; attempt: number; status: string; latencyMs: number | null;
  errorCode: string | null; httpStatus: number | null; inputTokens: number | null; outputTokens: number | null;
  cacheHitTokens: number | null; cacheMissTokens: number | null; schemaValid: boolean | null;
  gameCommitted: boolean | null; promptLayoutVersion: number | null };
type CallDetail = { requestId: string; attempt: number; events: unknown[]; comparison?: {
  modelStatus: string; modelSelected: string | null; jevChoice: string | null;
  jevSampledSelected: string | null; modelChoiceProbability: number | null;
  matchesJevChoice: boolean | null; matchesJevSample: boolean | null } };
type Usage = { inputTokens: number; outputTokens: number; reportedCalls: number; unreportedCalls: number;
  cacheHitTokens: number; cacheMissTokens: number; cacheReportedCalls: number;
  cacheUnreportedCalls: number; cacheRate: number | null;
  cacheBySeat: { key: string; hitTokens: number; missTokens: number; rate: number | null; calls: number }[];
  cacheByPhase: { key: string; hitTokens: number; missTokens: number; rate: number | null; calls: number }[] };

const statusNames: Record<string, string> = { started: '进行中', succeeded: '供应商已返回', failed: 'API 调用失败',
  unknown: '结果未知', 'not-sent': '请求未发出' };

export function ModelDiagnostics({ roomId }: { roomId: string }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [after, setAfter] = useState(0);
  const [seat, setSeat] = useState('');
  const [result, setResult] = useState('');
  const [interaction, setInteraction] = useState('');
  const [phase, setPhase] = useState('');
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const query = new URLSearchParams({ after: String(after), limit: '100' });
        if (seat) query.set('seat', seat);
        if (result) query.set('result', result);
        if (interaction) query.set('interaction', interaction);
        const [callResponse, usageResponse] = await Promise.all([
          fetch(`/api/werewolf/model/${roomId}/model-calls?${query}`),
          fetch(`/api/werewolf/model/${roomId}/usage`),
        ]);
        if (!callResponse.ok || !usageResponse.ok) throw new Error('诊断查询失败，请检查本机模型测试服务');
        const [nextCalls, nextUsage] = await Promise.all([callResponse.json() as Promise<Call[]>, usageResponse.json() as Promise<Usage>]);
        if (!stopped) { setCalls(nextCalls); setUsage(nextUsage); setError(''); }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : '诊断查询失败'); }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [roomId, after, seat, result, interaction]);
  async function inspect(call: Call) {
    setError('');
    try {
      const response = await fetch(`/api/werewolf/model/${roomId}/model-calls/${call.requestId}/${call.attempt}`);
      if (!response.ok) throw new Error('调用详情读取失败');
      setDetail(await response.json() as CallDetail);
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start' }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '调用详情读取失败'); }
  }
  const phases = [...new Set(calls.map(call => call.phase).filter((value): value is string => !!value))].sort();
  const shown = phase ? calls.filter(call => call.phase === phase) : calls;
  return <section className="ww-diagnostics">
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
        <label>交互类型 <select value={interaction} onChange={event => { setInteraction(event.target.value); setAfter(0); setPhase(''); setDetail(null); }}>
          <option value="">全部</option><option value="SELECT">SELECT · 选择</option><option value="SPEECH">SPEECH · 发言</option></select></label>
        <label>阶段 <select value={phase} onChange={event => setPhase(event.target.value)}>
          <option value="">全部</option>{phases.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      {detail !== null && <div ref={detailRef} className="ww-diagnostic-detail"><h3>私密调用详情 · {detail.requestId}</h3>
        <button onClick={() => setDetail(null)}>收起详情</button>
        {detail.comparison && <div className="ww-diagnostic-comparison">
          <b>原模型与 JEV 对照</b>
          <p>原模型：{detail.comparison.modelStatus} · {detail.comparison.modelSelected ?? '未提交'}</p>
          <p>JEV 最高权重：{detail.comparison.jevChoice ?? '未知'} · 抽样结果：{detail.comparison.jevSampledSelected ?? '未知'}</p>
          <p>原模型选项在 JEV 原始分布中的概率：{detail.comparison.modelChoiceProbability === null ? '未知' : `${(detail.comparison.modelChoiceProbability * 100).toFixed(1)}%`}</p>
        </div>}
        <details><summary>查看完整私密请求、响应和 JEV 原始日志</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>
      </div>}
      <div className="ww-diagnostic-list">{shown.length === 0 && <p>当前筛选没有调用记录。</p>}
        {shown.map(call => <button key={`${call.requestId}:${call.attempt}:${call.sequence}`} onClick={() => void inspect(call)}>
          <b>{call.interaction ?? '类型未知'} · {call.seatNo ?? '—'}号 · {call.phase ?? '未知阶段'} · {statusNames[call.status] ?? call.status}</b>
          <small>{new Date(call.occurredAt).toLocaleString()} · 第 {call.attempt} 次 · {call.profile ?? '未记录'}</small>
          <small>{call.errorCode ? `错误 ${call.errorCode}` : call.schemaValid === false ? '返回内容不符合 Schema' :
            call.gameCommitted === false ? '裁判未接受' : call.gameCommitted === true ? '裁判已接受' : ''}
            {call.httpStatus ? ` · HTTP ${call.httpStatus}` : ''}{call.latencyMs === null ? '' : ` · ${call.latencyMs} ms`}</small>
          <small>输入 {call.inputTokens ?? '未知'} / 输出 {call.outputTokens ?? '未知'} · 缓存 {call.cacheHitTokens ?? '未知'} / {call.cacheMissTokens ?? '未知'}</small>
          <small>查看私密调用详情</small>
        </button>)}</div>
      <div className="ww-diagnostic-pages"><button disabled={after === 0} onClick={() => setAfter(0)}>第一页</button>
        <button disabled={calls.length < 100} onClick={() => setAfter(calls.at(-1)!.sequence)}>下一页</button></div>
    {error && <p role="alert" className="ww-diagnostic-error">{error}</p>}
  </section>;
}
