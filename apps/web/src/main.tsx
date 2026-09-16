import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, LoginPanel, useIdentity, type UserSession } from '@game-ai/identity/browser';
import './style.css';
import { WorldView, type WorldViewData } from './world-view';
import { acceptSnapshot } from './snapshot';
import type { GameAction } from '../../../examples/wuxia-mud/src/scene.ts';

type Pending={requestId:string;expectedMemoryVersion:number;action:string;note:string;exitId?:string;targetId?:string;topicId?:string;questId?:string;itemId?:string;name?:string;gender?:string;schoolId?:string;skillId?:string;enemyId?:string};
type Player={scopeId:string;name:string};
type Message={id:string;channel:string;body:string;senderScopeId:string;senderName:string;recipientScopeId:string|null;recipientName:string|null};
type Game=WorldViewData & {id:string;state:{silver:number;virtue:number;skill:number;master:string|null;hostVersion:number;encounterDone:boolean;name:string;gender:string;hp:number;maxHp:number;qi:number;maxQi:number;experience:number;potential:number;schoolId:string|null};memoryVersion:number;events:any[];openItems:any[];playersHere:Player[];messages:Message[];party:{id:string;members:Player[]}|null;invites:{id:string;fromScopeId:string;fromName:string}[]};
const choices=[{id:'good_deed',name:'行善',symbol:'善',description:'接济村民，积累侠义',kind:'游戏运算'}, {id:'encounter',name:'奇遇',symbol:'缘',description:'循着旧事，遇见新缘',kind:'AI 综合判定'}, {id:'apprenticeship',name:'拜师',symbol:'师',description:'叩问青松，求取心法',kind:'AI 综合判定'}, {id:'challenge',name:'挑战',symbol:'武',description:'与人切磋，检验武学',kind:'游戏运算'}];
const errors:Record<string,string>={INSUFFICIENT_SILVER:'银两不足，无法接济村民。',LOW_VIRTUE:'侠义需达到 2 才能拜师。',ALREADY_APPRENTICED:'你已有师门，不能改投。',ENCOUNTER_COMPLETED:'这段奇遇已经完成。',INSUFFICIENT_POTENTIAL:'潜能不足，需要 2 点潜能。',INSUFFICIENT_QI:'内力不足，无法施展门派武学。',SKILL_PREREQUISITE:'基础武功达到 2 级后才能修习门派武学。',SKILL_MAXED:'这门武功已达当前上限。',QUEST_NOT_READY:'还未击退恶徒，不能复命。',INVALID_PROFILE:'姓名或性别不符合要求。',MODEL_TIMEOUT:'判定超时，本次行动未生效。',MODEL_UNAVAILABLE:'模型暂时不可用，本次行动未生效。',MODEL_INVALID_OUTPUT:'判定格式不合法，本次行动未生效。',STATE_CONFLICT:'状态已变化，请重新提交。',PROCESSING_EXPIRED:'上次处理已过期，本次行动未生效。'};
function saved<T>(key:string):T|null {try{return JSON.parse(localStorage.getItem(key)??'null');}catch{return null;}}
function App(){
  const identity = useIdentity();
  const [logoutError, setLogoutError] = useState('');
  const [leaving, setLeaving] = useState(false);
  async function logout() {
    if (!identity.session) return;
    setLeaving(true); setLogoutError('');
    try {
      await identity.logout();
      localStorage.removeItem(`pending:${identity.session.userId}:${identity.session.currentScopeId}`);
      localStorage.removeItem(`reset:${identity.session.userId}`);
    } catch { setLogoutError('登出失败，请检查连接后重试。'); }
    finally { setLeaving(false); }
  }
  return <div className="shell"><header><a className="brand" href="/">江湖一隅 <span>WUXIA / HARNESS</span></a>
    {identity.session && <div className="account"><span>{identity.session.username}</span><button className="text-button" disabled={leaving} onClick={()=>void logout()}>登出</button></div>}
  </header>
  <section className={`intro ${identity.session ? 'in-world' : ''}`}><div className="eyebrow">青溪镇 · 江湖初行</div><h1>行一步江湖，<em>留一段来日。</em></h1><p>循路访人，拾取一段故事。你的每一步，都留在这片江湖。</p></section>
  {logoutError && <p role="alert">{logoutError}</p>}
  {identity.loading ? <p role="status">正在恢复登录与存档…</p> : identity.error ? <section className="welcome"><p role="alert">{identity.error}</p><button onClick={()=>void identity.restore()}>重试</button></section> : identity.session ?
    <GameView key={identity.session.userId+identity.session.currentScopeId} session={identity.session} restore={identity.restore} leaving={leaving}/> :
    <LoginPanel login={identity.login} legacy={!!saved('harness-session')}/>}
  <footer><span>游戏掌握规则，AI 参与判定。</span><span>记忆 · 上下文 · 校验 · 执行</span></footer></div>;
}
function GameView({session,restore,leaving}:{session:UserSession;restore:()=>Promise<void>;leaving:boolean}){
  const pendingKey=`pending:${session.userId}:${session.currentScopeId}`;
  const resetKey=`reset:${session.userId}`;
  const [pending,setPending]=useState<Pending|null>(()=>saved(pendingKey));
  const [resetRequest,setResetRequest]=useState<{requestId:string;expectedCurrentScopeId:string}|null>(()=>saved(resetKey));
  const [confirmReset,setConfirmReset]=useState(false);
  const [game,setGame]=useState<Game|null>(null);const [note,setNote]=useState('');const [error,setError]=useState('');const [mode,setMode]=useState('mock');const [starting,setStarting]=useState(false);
  const [socialText,setSocialText]=useState(''); const [channel,setChannel]=useState<'say'|'tell'|'chat'>('say'); const [socialTarget,setSocialTarget]=useState('');
  const [profileName,setProfileName]=useState(''); const [profileGender,setProfileGender]=useState('未设定');
  const busy=useRef(false);
  const active=useRef(true);
  const refreshSequence=useRef(0);
  const [synced,setSynced]=useState(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function refresh(){
    const sequence=++refreshSequence.current;
    try{
      const current:Game=await api(`/api/wuxia/games/${session.currentScopeId}`);
      if(!active.current)return;
      setGame(previous=>acceptSnapshot(session.currentScopeId,previous,current));
      if(sequence===refreshSequence.current)setSynced(true);
    }catch(e){if(active.current&&sequence===refreshSequence.current)setSynced(false);throw e;}
  }
  useEffect(()=>{
    const focus=()=>{void refresh().catch(e=>{if(e instanceof ApiError&&[401,403].includes(e.status))void restore();});};
    window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);
  },[session.currentScopeId]);
  useEffect(()=>{void fetch('/api/health').then(r=>r.json()).then(r=>setMode(r.modelMode));},[]);
  useEffect(()=>{void refresh().catch(e=>{if(e instanceof ApiError && [401,403].includes(e.status))void restore();else setError('无法读取存档，请检查服务是否运行。');});},[session]);
  useEffect(()=>{const timer=setInterval(()=>{if(!pending&&!leaving)void refresh().catch(()=>{});},3000);return()=>clearInterval(timer);},[session.currentScopeId,pending,leaving]);
  useEffect(()=>{if(game&&!profileName){setProfileName(game.state.name);setProfileGender(game.state.gender);}},[game?.id]);
  useEffect(()=>{
    if(!pending||leaving)return;
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        let result;
        try{result=await api(`/api/wuxia/games/${session.currentScopeId}/requests/${pending.requestId}`);}catch(e){
          if((e as any).status!==404)throw e;
          // If the initial POST was lost, resend the SAME id and payload.
          result=await api(`/api/wuxia/games/${session.currentScopeId}/actions`,{method:'POST',body:JSON.stringify(pending)});
        }
        if(cancelled)return;
        if(result.status!=='processing'){
          await refresh();if(cancelled)return;
          if(result.status!=='committed')setError(errors[result.error?.detail]??errors[result.error?.code]??'行动未生效，请重试。');else{setError('');setNote('');}
          localStorage.removeItem(pendingKey);setPending(null);busy.current=false;return;
        }
      }catch(e){if(cancelled)return;const status=(e as any).status;if(status===401||status===403){localStorage.removeItem(pendingKey);setPending(null);void restore();return;}if(status===409||status===400){setError('请求未登记，存档可能已变化，请重新提交。');localStorage.removeItem(pendingKey);setPending(null);busy.current=false;void refresh().catch(()=>{});return;}setError('连接中断，正在查询原行动结果…');}
      if(!cancelled)timer=setTimeout(poll,700);
    };void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[session,pending,leaving]);
  async function begin(){
    setStarting(true);setError('');
    const payload=resetRequest??{requestId:crypto.randomUUID(),expectedCurrentScopeId:session.currentScopeId};
    localStorage.setItem(resetKey,JSON.stringify(payload));setResetRequest(payload);
    try{await api('/api/game/current/reset',{method:'POST',body:JSON.stringify(payload)});localStorage.removeItem(resetKey);localStorage.removeItem(pendingKey);await restore();}
    catch(e){if(e instanceof ApiError&&e.status<500){localStorage.removeItem(resetKey);setResetRequest(null);if([401,403].includes(e.status)){void restore();return;}setError(e.code==='SCOPE_BUSY'?'原档案仍有行动在处理，请稍后再试。':'当前档案已变化，请重新加载。');}else setError('连接中断，请重试确认同一次新局结果。');}
    finally{setStarting(false);setConfirmReset(false);}
  }
  function act(selection:GameAction){if(!game||!synced||pending||busy.current||resetRequest||starting||leaving)return;busy.current=true;setError('');const {label,...action}=selection;const payload={requestId:crypto.randomUUID(),expectedMemoryVersion:game.memoryVersion,...action,note};localStorage.setItem(pendingKey,JSON.stringify(payload));setPending(payload);}
  async function social(path:string,payload:Record<string,unknown>){if(!game)return;setError('');try{await api(`/api/wuxia/games/${game.id}/social/${path}`,{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),...payload})});await refresh();}catch(e){setError((e as any).code==='PARTY_FULL'?'队伍已满。':'社交操作未生效，请重试。');}}
  async function sendSocial(){if(!socialText.trim())return;await social('messages',{channel,body:socialText,targetScopeId:channel==='tell'?socialTarget:undefined});setSocialText('');}
  return <><p className="mode"><i/>{mode==='mock'?'演示模型 · 固定判定':'真实模型'}</p>
    {resetRequest&&<div className="notice">有一次新局请求等待确认。<button disabled={starting||leaving} onClick={()=>void begin()}>重试原请求</button></div>}
    {!game?<section className="welcome"><p>{error||'正在读取长期存档…'}</p>{error&&<button onClick={()=>void refresh().catch(()=>setError('无法读取存档，请重试。'))}>重试读取</button>}</section>:<div className="layout"><main>
      <div className="section-head"><h2>此刻 · {game.scene.name}</h2><span>已记录 {game.memoryVersion} 次行动</span></div>
      {!synced&&<div className="error" role="alert">状态尚未同步，当前显示上次存档。<button onClick={()=>void refresh().catch(()=>{})}>重试同步</button></div>}
      <WorldView game={game} act={act} disabled={!synced||!!pending||!!resetRequest||starting||leaving}/>
      <label className="note">留一句话给这次行动 <span>可选</span><textarea value={note} maxLength={200} disabled={!!pending} onChange={e=>setNote(e.target.value)} placeholder="例如：我愿先助乡里，再求武学。"/></label>
      {pending&&<div className="notice" role="status">行动处理中… 结果确认后才会写入江湖。</div>}
      {error&&<div className="error" role="alert">{error}</div>}
      <p className="latest-result" aria-live="polite">{game.events.at(-1)?.payload.message??'初入江湖，不妨沿青石街寻访药铺。'}</p>
      <details><summary>展开江湖旧事 · {game.events.length} 条</summary>
      <div className="timeline">{game.events.length===0?<p className="empty">尚无往事。每次已确认的行动都会留在这里。</p>:[...game.events].reverse().map((event,i)=><article key={event.id}><span className="event-number">{String(game.events.length-i).padStart(2,'0')}</span><div><small>{choices.find(c=>c.id===event.payload.action)?.name}</small><p>{event.payload.message}</p></div></article>)}</div>
      </details>
    </main><aside><div className="character"><div className="eyebrow">你的角色</div><h2>{game.state.name}</h2><p className="master">{game.state.master?`师承 · ${game.state.master}`:'无门无派，自在江湖'}</p><div className="vitals"><span>气血 {game.state.hp}/{game.state.maxHp}</span><span>内力 {game.state.qi}/{game.state.maxQi}</span><span>经验 {game.state.experience} · 潜能 {game.state.potential}</span></div><dl><div><dt>银两</dt><dd>{game.state.silver}<small>两</small></dd></div><div><dt>侠义</dt><dd>{game.state.virtue}</dd></div><div><dt>武学</dt><dd>{game.state.skill}</dd></div></dl>
      <details><summary>修改角色档案</summary><input value={profileName} maxLength={12} aria-label="角色姓名" onChange={e=>setProfileName(e.target.value)}/><select value={profileGender} aria-label="角色性别" onChange={e=>setProfileGender(e.target.value)}><option>未设定</option><option>男</option><option>女</option></select><button disabled={!!pending} onClick={()=>act({action:'set_profile',label:'保存档案',name:profileName,gender:profileGender})}>保存</button></details>
      {game.state.schoolId&&<div className="skill-actions"><h3>修习武功</h3>{(game.state.schoolId==='qingsong'?['breathing','qingsong_sword']:['herbal_breath','acupoint_hand']).map(id=><button key={id} disabled={!!pending||game.state.potential<2} onClick={()=>act({action:'learn_skill',label:'修习',skillId:id})}>修习 {id==='breathing'?'吐纳法':id==='qingsong_sword'?'青松剑式':id==='herbal_breath'?'采息术':'点穴手'}（2潜能）</button>)}</div>}
      </div>
      <div className="social"><h3>同在此地</h3>{game.playersHere.length?game.playersHere.map(p=><div className="player-row" key={p.scopeId}><span>{p.name}</span><button onClick={()=>void social('party',{action:'invite',targetScopeId:p.scopeId})}>邀入队</button><button onClick={()=>{setChannel('tell');setSocialTarget(p.scopeId);}}>密语</button></div>):<p>此刻没有其他在线玩家。</p>}
      <h3>江湖传音</h3><div className="channel"><select value={channel} onChange={e=>setChannel(e.target.value as any)}><option value="say">同房</option><option value="chat">江湖</option><option value="tell">密语</option></select>{channel==='tell'&&<select value={socialTarget} onChange={e=>setSocialTarget(e.target.value)}><option value="">选择对象</option>{game.playersHere.map(p=><option key={p.scopeId} value={p.scopeId}>{p.name}</option>)}</select>}</div><div className="messages">{game.messages.slice(-12).map(m=><p key={m.id}><b>{m.channel==='tell'?'密':m.channel==='chat'?'江':'近'} · {m.senderName}</b> {m.body}</p>)}</div><textarea value={socialText} maxLength={200} onChange={e=>setSocialText(e.target.value)} placeholder="说点什么…"/><button disabled={!socialText.trim()||(channel==='tell'&&!socialTarget)} onClick={()=>void sendSocial()}>发送</button>
      <h3>同行队伍</h3>{game.invites.map(i=><p key={i.id}>{i.fromName} 邀你同行 <button onClick={()=>void social('party',{action:'accept',inviteId:i.id})}>接受</button></p>)}{game.party?<><p>{game.party.members.map(m=>m.name).join('、')}</p><button onClick={()=>void social('party',{action:'leave'})}>离队</button></>:<p>尚未组队。</p>}</div>
      <div className="memory"><h3>未了之缘</h3>{game.openItems.filter(i=>i.status==='open').map(i=><p key={i.id}>{String(i.payload)}</p>)}{!game.openItems.some(i=>i.status==='open')&&<p>{game.state.encounterDone?'旧缘已结，所得留于此身。':'尚无未了之事。行善或许能结下一段缘。'}</p>}</div>
      <div className="guide"><h3>初入江湖</h3><p>行善两次，便具拜师资格。武学达到 2，即可赢得切磋。奇遇仅此一次。</p><button className="text-button" disabled={!!pending||starting||!!resetRequest||leaving} onClick={()=>setConfirmReset(true)}>另起一段江湖 ↗</button>
      {confirmReset&&<div role="dialog" aria-label="确认开启新江湖"><p>开启后旧局结束，旧档案会保留，但当前版本不能切回。确定开启吗？</p><button disabled={starting||leaving} onClick={()=>void begin()}>确认开启新江湖</button><button disabled={starting} onClick={()=>setConfirmReset(false)}>取消</button></div>}</div>
    </aside></div>}
    </>;
}
createRoot(document.getElementById('root')!).render(<App/>);


