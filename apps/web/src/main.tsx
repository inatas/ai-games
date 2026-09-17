import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, LoginPanel, useIdentity, type UserSession } from '@game-ai/identity/browser';
import type { WorldView as View, GameAction } from '@game-ai/game-systems';
import { WorldView } from './world-view';
import { acceptSnapshot } from './snapshot';
import './style.css';

type Player = {scopeId:string;name:string};
type Game = View & {
  id:string; memoryVersion:number; events:{id:string;payload:{message:string}}[];
  playersHere:Player[]; messages:{id:string;senderName:string;body:string}[];
  party:{id:string;members:Player[]}|null; invites:{id:string;fromName:string}[];
};
type Pending={requestId:string;expectedMemoryVersion:number;action:string;note:string;[key:string]:string|number};
function saved<T>(key:string):T|null {try{return JSON.parse(localStorage.getItem(key)??'null');}catch{return null;}}
function App(){
  const identity=useIdentity();const [error,setError]=useState('');
  return <div className="shell"><header><a className="brand" href="/">世界行记</a>{identity.session&&<div className="account">{identity.session.username}<button onClick={()=>void identity.logout().catch(()=>setError('登出失败，请重试。'))}>登出</button></div>}</header>
    {error&&<p role="alert">{error}</p>}
    {identity.loading?<p>正在恢复档案…</p>:identity.error?<p>{identity.error}<button onClick={()=>void identity.restore()}>重试</button></p>:identity.session?<GameView key={identity.session.currentScopeId} session={identity.session} restore={identity.restore}/>:<LoginPanel login={identity.login}/>}
    <footer>行动与故事持续保存在世界中。</footer></div>;
}
function GameView({session,restore}:{session:UserSession;restore:()=>Promise<void>}){
  const pendingKey='pending:'+session.userId+':'+session.currentScopeId;
  const socialKey='social:'+session.userId+':'+session.currentScopeId;
  const resetKey='reset:'+session.userId;
  const [game,setGame]=useState<Game|null>(null),[pending,setPending]=useState<Pending|null>(()=>saved(pendingKey));
  const [error,setError]=useState(''),[note,setNote]=useState(''),[text,setText]=useState(''),[channel,setChannel]=useState('say'),[target,setTarget]=useState('');
  const [synced,setSynced]=useState(false),[socialBusy,setSocialBusy]=useState(false),[resetting,setResetting]=useState(false),[confirmReset,setConfirmReset]=useState(false);
  const active=useRef(true),busy=useRef(false),sequence=useRef(0);
  useEffect(()=>()=>{active.current=false;},[]);
  async function refresh(){
    const n=++sequence.current;
    try{const incoming:Game=await api('/api/mud/current');if(active.current&&n===sequence.current){setGame(old=>acceptSnapshot(session.currentScopeId,old,incoming));setSynced(true);}}
    catch(e){if(active.current&&n===sequence.current)setSynced(false);if(e instanceof ApiError&&[401,403].includes(e.status))await restore();throw e;}
  }
  useEffect(()=>{
    const tick=async()=>{try{await api('/api/mud/presence',{method:'POST',body:'{}'});await refresh();}catch{if(active.current)setError('连接暂时中断，请重试。');}};
    void tick();const timer=setInterval(()=>void tick(),3000);return()=>clearInterval(timer);
  },[]);
  useEffect(()=>{
    if(!pending)return;let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        let result;
        try{result=await api('/api/mud/requests/'+pending.requestId);}
        catch(e){if((e as ApiError).status!==404)throw e;result=await api('/api/mud/actions',{method:'POST',body:JSON.stringify(pending)});}
        if(cancelled)return;
        if(result.status!=='processing'){
          await refresh();if(cancelled)return;
          setError(result.status==='committed'?'':'行动未生效：'+(result.error?.detail??result.error?.code??'请重试'));
          setNote('');localStorage.removeItem(pendingKey);setPending(null);busy.current=false;return;
        }
      }catch(e){
        if(cancelled)return;
        if(e instanceof ApiError&&[400,401,403,409].includes(e.status)){localStorage.removeItem(pendingKey);setPending(null);busy.current=false;setError('状态已变化，请重新提交。');void refresh().catch(()=>{});return;}
        setError('正在查询原行动结果…');
      }
      if(!cancelled)timer=setTimeout(poll,700);
    };void poll();return()=>{cancelled=true;clearTimeout(timer);};
  },[pending]);
  function act(selection:GameAction){
    if(!game||!synced||pending||busy.current||resetting||selection.unavailableReason)return;
    busy.current=true;const {label,unavailableReason,...fields}=selection;
    const payload={...fields,requestId:crypto.randomUUID(),expectedMemoryVersion:game.memoryVersion,note} as Pending;
    localStorage.setItem(pendingKey,JSON.stringify(payload));setPending(payload);setError('');
  }
  async function social(path:string,payload:Record<string,unknown>){
    if(socialBusy)return;
    const request=saved<{path:string;payload:Record<string,unknown>}>(socialKey)??{path,payload:{...payload,requestId:crypto.randomUUID()}};
    setSocialBusy(true);localStorage.setItem(socialKey,JSON.stringify(request));
    try{await api('/api/mud/social/'+request.path,{method:'POST',body:JSON.stringify(request.payload)});localStorage.removeItem(socialKey);setText('');setError('');await refresh();}
    catch(e){if(e instanceof ApiError&&e.status<500)localStorage.removeItem(socialKey);setError('社交操作未确认；重试会使用原请求。');}
    finally{setSocialBusy(false);}
  }
  async function reset(){
    setResetting(true);const request=saved(resetKey)??{requestId:crypto.randomUUID(),expectedCurrentScopeId:session.currentScopeId};
    localStorage.setItem(resetKey,JSON.stringify(request));
    try{await api('/api/game/current/reset',{method:'POST',body:JSON.stringify(request)});localStorage.removeItem(resetKey);localStorage.removeItem(pendingKey);localStorage.removeItem(socialKey);await restore();}
    catch(e){
      if(e instanceof ApiError){
        const messages:Record<string,string>={
          SCOPE_BUSY:'当前行动仍在处理中，请稍后再试。',
          STATE_CONFLICT:'当前档案已变化，正在刷新后请重新操作。',
          IDEMPOTENCY_CONFLICT:'该新角色请求已失效，请重新发起。',
          FORBIDDEN:'当前会话无权开启新角色。',
          UNAUTHENTICATED:'登录状态已过期，请重新登录。'
        };
        if(e.code!=='SCOPE_BUSY')localStorage.removeItem(resetKey);
        setError(messages[e.code]??`新角色创建失败：${e.code}`);
        if(e.code==='STATE_CONFLICT')await restore().catch(()=>{});
      } else setError('新角色创建失败，请重试。');
    }
    finally{setResetting(false);}
  }
  if(!game)return <p>{error||'正在读取世界…'}</p>;
  return <><section className="intro in-world"><h1>{game.title}</h1><p>探索、相遇，与同行者共同留下故事。</p></section><div className="layout"><main>
    {!synced&&<p role="alert">当前显示上次档案，等待同步。</p>}<WorldView game={game} disabled={!synced||!!pending||resetting} act={act}/>
    <label className="note">行动说明<textarea value={note} maxLength={200} onChange={e=>setNote(e.target.value)}/></label>
    {pending&&<p role="status">行动处理中…</p>}{error&&<p role="alert" className="error">{error}</p>}
    <p className="latest-result" aria-live="polite">{game.events.at(-1)?.payload.message??'选择场景中的对象开始探索。'}</p>
    <details><summary>历史记录</summary><div className="timeline">{[...game.events].reverse().map(e=><p key={e.id}>{e.payload.message}</p>)}</div></details>
  </main><aside><section className="character"><h2>{game.characterName}</h2><dl>{game.attributes.map(a=><div key={a.label}><dt>{a.label}</dt><dd>{a.value}</dd></div>)}</dl><div className="skill-actions">{game.training.map(a=><div key={a.skillId??a.label} className="training-option"><button disabled={!!pending||!synced||!!a.unavailableReason} aria-describedby={a.unavailableReason?`training-${a.skillId}`:undefined} onClick={()=>act(a)}>{a.label}</button>{a.unavailableReason&&<small id={`training-${a.skillId}`} className="training-reason">{a.unavailableReason}</small>}</div>)}</div>
    {game.forms?.map(form=><details key={form.action}><summary>{form.label}</summary><form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);act({action:form.action,label:form.label,...Object.fromEntries([...data.entries()].map(([k,v])=>[k,String(v)]))});}}>{form.fields.map(field=><label key={field.id}>{field.label}{field.options?<select name={field.id} defaultValue={field.value}>{field.options.map(o=><option key={o}>{o}</option>)}</select>:<input name={field.id} defaultValue={field.value} maxLength={field.maxLength} required/>}</label>)}<button disabled={!!pending||!synced}>保存</button></form></details>)}
    </section>
    <section className="social"><h3>此地同行者</h3>{game.playersHere.map(p=><div className="player-row" key={p.scopeId}><span>{p.name}</span><button disabled={socialBusy} onClick={()=>void social('party',{action:'invite',targetScopeId:p.scopeId})}>邀请</button><button onClick={()=>{setChannel('tell');setTarget(p.scopeId);}}>私聊</button></div>)}
    <h3>消息</h3><select aria-label="频道" value={channel} onChange={e=>setChannel(e.target.value)}><option value="say">同房</option><option value="chat">世界</option><option value="tell">私聊</option></select>
    {channel==='tell'&&<select aria-label="私聊对象" value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择对象</option>{game.playersHere.map(p=><option key={p.scopeId} value={p.scopeId}>{p.name}</option>)}</select>}
    <div className="messages">{game.messages.map(m=><p key={m.id}><b>{m.senderName}</b> · {m.body}</p>)}</div>
    <textarea aria-label="消息正文" value={text} maxLength={200} onChange={e=>setText(e.target.value)}/><button disabled={socialBusy||!text.trim()||(channel==='tell'&&!target)} onClick={()=>void social('messages',{channel,body:text,...(channel==='tell'?{targetScopeId:target}:{})})}>发送</button>
    {!!saved(socialKey)&&<button disabled={socialBusy} onClick={()=>void social('messages',{})}>重试原请求</button>}
    <h3>队伍</h3>{game.invites.map(i=><p key={i.id}>{i.fromName} 邀请你 <button disabled={socialBusy} onClick={()=>void social('party',{action:'accept',inviteId:i.id})}>接受</button></p>)}
    {game.party?<><p>{game.party.members.map(p=>p.name).join('、')}</p><button disabled={socialBusy} onClick={()=>void social('party',{action:'leave'})}>离队</button></>:<p>尚未组队。</p>}</section>
    <button disabled={!!pending||resetting} onClick={()=>setConfirmReset(true)}>开启新角色</button>
    {(confirmReset||!!saved(resetKey))&&<div role="dialog" aria-label="新角色确认"><p>旧档保留，当前角色退出队伍，共享世界继续存在。</p><button disabled={resetting} onClick={()=>void reset()}>确认</button><button onClick={()=>{localStorage.removeItem(resetKey);setConfirmReset(false);}}>取消</button></div>}
  </aside></div></>;
}
createRoot(document.getElementById('root')!).render(<App/>);


