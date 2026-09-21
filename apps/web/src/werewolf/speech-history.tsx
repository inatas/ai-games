import { useEffect, useRef, useState } from 'react';
import { portraitStyle } from './seat-avatar.tsx';
import './speech-history.css';

const exampleDays = [
  [
    { phase: '上警发言', seat: 2, text: '我跳预言家，昨晚验了5号是好人。先说验人理由：首夜没有公开信息，我选5号，不是因为他发言像好人。\n\n今天我重点听7号。他上警很积极，但还没有交代自己的判断依据。我不是现在就认定他是狼，而是希望他把逻辑讲完整。\n\n警徽先给我。如果有人对跳，请把验人顺序说清楚。大家不要因为我给了好人身份，就直接站到我这边。' },
    { phase: '上警发言', seat: 7, text: '2号，你还没听我发言，就先把焦点放在我身上，这个动作我不认可。我也跳预言家，昨晚验9号是狼。\n\n你说不是认定我是狼，却又让大家重点听我，这两句话在引导同一个方向。5号也别急着替2号说话，拿到好人身份不等于他一定是真预言家。\n\n我希望9号正面回应我的查验。今天先把两个预言家的逻辑摆在一起，再决定警徽和放逐票。' },
    { phase: '遗言 · 昨夜出局', seat: 3, text: '我走了。别只看谁说得像预言家，要听两个人的验人理由。\n\n2号给5号好人身份，5号却没有直接站边，这点值得继续观察。7号的发言很强势，但强势本身不代表身份。留下的人把今天的投票记下来，明天再对照。' },
    { phase: '放逐发言', seat: 5, text: '2号给我好人身份，我也不会直接站边。7号，先解释为什么验9号。\n\n目前我听到的是两个人互相质疑，但还没有谁把自己的证据讲得足够清楚。我会把警上说法和这一轮发言一起看，尤其留意有没有人悄悄换了判断标准。' },
    { phase: '放逐发言', seat: 9, text: '7号给我查杀，我不认。2号的逻辑更完整，今天我会投7号。\n\n我希望5号说清楚最终站哪一边。保持怀疑没有问题，但投票的时候总要给出能被大家检验的理由。' },
    { phase: '放逐PK发言', seat: 7, text: '进入平票我再回应一次：9号一直在比较谁说得完整，却没有回答我对他的质疑。请刚才弃票的人认真想一想，你们是在判断身份，还是只在判断表达方式？' },
    { phase: '放逐PK发言', seat: 9, text: '7号把我的每一句反驳都当成可疑点，但没有给出新的依据。我坚持刚才的判断，也接受大家明天复盘我的投票。' },
  ],
  [
    { phase: '放逐发言', seat: 5, text: '今天先复盘昨天的发言和票型。我昨天没有因为2号给我好人身份就直接站边，今天也一样。\n\n7号反复要求9号解释，但对自己的验人理由说得很少；2号提出要观察7号，后面有没有真的跟进，也需要大家回看。两个人都要接受同一套标准。\n\n我更在意谁在关键时刻改变了说法。请大家逐条回应，不要只说“我觉得他像好人”。我们把昨天的判断拿出来，看哪些被后续信息支持，哪些应该修正。' },
    { phase: '放逐发言', seat: 2, text: '5号说要用同一套标准，我同意。但如果每一轮都停在“还要观察”，我们就没有办法形成投票。\n\n我昨天把怀疑点摆在台面上，今天也愿意逐条回应。7号有没有解释最初的验人选择？9号的回应和他后续的票型是否一致？这些都可以从历史发言里核对。\n\n我的建议是先把分歧收敛到具体问题。谁认为我的判断有漏洞，就指出是哪一句、哪一步，我会正面回答。' },
    { phase: '放逐发言', seat: 11, text: '两边都有值得追问的地方。我暂时更倾向5号的复盘方式：把说过的话和做过的选择放在一起看。\n\n不过2号说得也对，讨论最终要落到投票。我会在听完这一轮后给出明确选择，而不是一直保留所有可能。' },
    { phase: '遗言 · 放逐出局', seat: 2, text: '我的发言到这里。请留下的人把今天的投票和昨天的发言连起来看，不要只记住最后一个发言的人。\n\n如果后续信息证明我判断错了，就修正；如果有人前后说法矛盾，也请继续追问。' },
  ],
];

export function HistoryIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15M5 7h4M5 10h4M15 7h4M15 10h4"/></svg>;
}

export function SpeechHistory({ preview, currentDay, close }: { preview: boolean; currentDay: number; close: () => void }) {
  const [day, setDay] = useState(currentDay);
  const dialog = useRef<HTMLDialogElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const speeches = preview ? exampleDays[day - 1] ?? [] : [];
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (messages.current) messages.current.scrollTop = 0; }, [day]);

  return <dialog className="ww-history" ref={dialog} aria-labelledby="history-title" onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header><h2 id="history-title">历史发言</h2><button type="button" aria-label="关闭历史发言" onClick={close}>×</button></header>
    <nav className="ww-history-days" aria-label="选择发言天数">{Array.from({ length: currentDay }, (_, index) => index + 1).map(value => <button type="button" key={value} aria-pressed={value === day} onClick={() => setDay(value)}>第{value}天</button>)}</nav>
    <p className="ww-history-context">第{day}天 · {preview ? '原型示例 · 非实际AI发言' : '公开发言'}</p>
    <div className="ww-history-messages" ref={messages} tabIndex={0} role="region" aria-label={`第${day}天发言记录`}>
      {speeches.length === 0 && <div className="ww-history-empty"><HistoryIcon/><p>当天暂无发言</p><small>当前演示使用静默策略，尚未接入文字发言。</small></div>}
      {speeches.map((speech, index) => <section key={`${day}-${index}`}>
        {speech.phase !== speeches[index - 1]?.phase && <h3 className="ww-history-phase">{speech.phase}</h3>}
        <article className="ww-speech" aria-label={`${speech.seat}号玩家，${speech.phase}`}>
          <div className="ww-speech-avatar" style={portraitStyle(speech.seat)} aria-hidden="true"><b>{speech.seat}</b></div>
          <div className="ww-speech-content"><h4>{speech.seat}号玩家</h4><div className="ww-speech-bubble">{speech.text.split('\n\n').map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</div></div>
        </article>
      </section>)}
    </div>
    <footer><small>按阶段与发言顺序排列</small><button type="button" disabled={!speeches.length} onClick={() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight; }}>回到最新 ↓</button></footer>
  </dialog>;
}
