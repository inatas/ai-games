/** Browser fixture: real presentation components, synthetic public snapshots, no network/model calls. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpeechBubble, LiveTransition, SpeakerAvatar } from '../../web/live-scene.tsx';
import { SeatAvatar } from '../../web/seat-avatar.tsx';
import { RobotUsersContext } from '../../web/robot-context.tsx';
import type { DemoSnapshot } from '../../shared/werewolf.ts';
import '../../web/room.css';
import '../../web/speech-history.css';

const short = '我先说一下我的判断。\n结合前面的发言和票型，\n我想再听听后面的解释。';
const long = '我先说一下我的判断。结合前面的发言和票型，我想再听听后面的解释。当前的公开信息还不能证明每个人的身份，请大家把自己的理由讲清楚。不要仅凭一句话就认定对方是狼人，我们可以对照昨天的投票和今天的站边变化。接下来我会重点听两件事：昨天为什么投给那个位置，以及今天为什么改变判断。如果理由前后矛盾，我会继续追问。我的暂定选择并不是最终结论，听完后面的发言再作决定。';
const initial: DemoSnapshot = {
  id: 'visual-fixture', revision: 1, status: 'running', day: 2, period: 'day', phaseLabel: '放逐发言',
  speakerSeat: 1, currentSpeech: { seat: 1, text: short, revision: 1 }, actor: 1,
  timing: { remainingMs: 120_000 }, speeches: [], events: [], nightSegment: null, progress: null, sheriff: null, result: null,
  players: Array.from({ length: 12 }, (_, i) => ({ seat: i + 1, alive: true, user: {
    userId: `fixture-${i + 1}`, nickname: ['松风', '莓果团子', '桃子汽水', '听雨剑客', '花间眠', '云归', '林间旅人', '旧街灯', '暮色邮差', '青衣客', '竹影', '樱桃小丸'][i], gender: 'unspecified',
    avatar: { src: `/werewolf/user-avatar-${['brown', 'pink', 'blue'][i % 3]}.png`, size: i % 3 === 1 ? '315% 410%' : '370% 500%', position: i % 3 === 1 ? '49% 27%' : '49% 17%' },
    portrait: { src: `/werewolf/user-avatar-${['brown', 'pink', 'blue'][i % 3]}.png`, variant: ['brown', 'pink', 'blue'][i % 3] },
  } })),
};
function Fixture() {
  const [game, setGame] = useState(initial);
  const [reduced, setReduced] = useState(false);
  const [panel, setPanel] = useState(false);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    const timer = window.setInterval(() => setGame(value => ({ ...value, timing: { remainingMs: Math.max(0, value.timing.remainingMs - 1000) } })), 1000);
    return () => clearInterval(timer);
  }, []);
  function speak(seat: number, text = short) {
    setGame(value => ({ ...value, period: 'day', revision: value.revision + 1, speakerSeat: seat, actor: seat,
      currentSpeech: { seat, text, revision: value.revision + 1 }, timing: { remainingMs: 120_000 } }));
  }
  function period(value: 'day' | 'night') {
    setGame(game => ({ ...game, period: value, revision: game.revision + 1, speakerSeat: null, currentSpeech: null, actor: null }));
  }
  return <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 20, color: '#eee' }}>
    <style>{`.motion-fixture .ww-speech-text { clip-path:var(--speech-clip,none) !important; }
      .motion-fixture .ww-background::after { transition:opacity 1.2s ease-in-out !important; }
      .motion-fixture .ww-transition.transition-day,.motion-fixture .ww-transition.transition-night { animation:ww-scene-dissolve 2s ease-in-out both !important; }`}</style>
    <aside style={{ padding: 16, maxWidth: 240 }}><h2>v5 展示验收</h2><p>模拟公开快照，无模型调用。可切换正常／减少动效以独立验证系统偏好的两种表现。</p>
      {[1, 5, 6, 10, 11, 12].map(seat => <button key={seat} onClick={() => speak(seat)}>{seat}号发言</button>)}
      <p><button onClick={() => speak(game.speakerSeat ?? 6, long)}>长文发言</button></p>
      <button onClick={() => period('night')}>切换黑夜</button><button onClick={() => period('day')}>切换白天</button>
      <p><label><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)}/>减少动效</label></p>
      <button onClick={() => setPanel(value => !value)}>{panel ? '关闭历史' : '打开历史'}</button>
    </aside>
    <RobotUsersContext.Provider value={game.players}><div className="ww-page"><main className={`ww-stage ${game.period === 'night' ? 'is-night' : ''} ${reduced ? 'reduced-motion' : 'motion-fixture'}`} aria-label="展示验收牌桌">
      <div className="ww-background"/><div className="ww-room"><small>房间号：</small><b>演示</b></div>
      <div className="ww-day"><span>{game.period === 'night' ? '☾' : '☀'}</span><b>第2{game.period === 'night' ? '夜' : '天'}</b></div>
      <div className="ww-type"><small>房间类型：</small><b>12人预女猎白</b></div>
      <section className={`ww-records ${expanded ? '' : 'collapsed'}`}><h1>第2天 · 放逐发言</h1><div className="ww-log"><div className="ww-card">昨夜平安夜，无人出局</div></div></section>
      <button className="ww-record-toggle" onClick={() => setExpanded(value => !value)}><span>{expanded ? '⋀' : '⋁'}</span>公开记录<span>{expanded ? '⋀' : '⋁'}</span></button>
      <div className="ww-status">{game.speakerSeat ? `${game.speakerSeat}号发言` : game.period === 'night' ? '夜间行动' : '白天'} · {Math.ceil(game.timing.remainingMs / 1000)}秒</div>
      {game.players.map(player => <SeatAvatar key={player.seat} seat={player.seat} active={game.speakerSeat === player.seat}/>)}
      <SpeakerAvatar seat={game.speakerSeat}/><SpeechBubble game={game} suppressed={panel} reduced={reduced}/>
      <button className="ww-history-entry" onClick={() => setPanel(true)}>历史</button><button className="ww-observer">公共旁观</button>
      <LiveTransition game={game} suppressed={panel} reduced={reduced}/>
      {panel && <section style={{ position: 'absolute', zIndex: 10, inset: '15% 20% 25%', padding: 20, background: '#4b3928 url(/werewolf/wood-panel.svg)', overflow: 'auto' }}><button onClick={() => setPanel(false)}>关闭历史</button><p>{game.currentSpeech?.text}</p></section>}
    </main></div></RobotUsersContext.Provider>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
