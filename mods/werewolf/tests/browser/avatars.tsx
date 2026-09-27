/** Real avatar components at mobile/desktop sizes; no game or model calls. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SeatAvatar, deathNames } from '../../web/seat-avatar.tsx';
import type { DeathDisplay } from '../../web/seat-state.ts';

const kinds: DeathDisplay[] = ['exile', 'night', 'explode', 'shot', 'knife', 'poison'];
function Fixture() {
  const [dead, setDead] = useState(true);
  const [result, setResult] = useState('待检查');
  async function verify() {
    const failures: string[] = [];
    for (const seat of document.querySelectorAll<HTMLElement>('.ww-seat')) {
      const label = seat.getAttribute('aria-label') ?? '';
      const sheriff = seat.querySelector<HTMLElement>('.sheriff');
      if (sheriff && (!sheriff.querySelector('svg') || sheriff.textContent?.includes('♛') || getComputedStyle(sheriff).backgroundColor !== 'rgba(0, 0, 0, 0)')) failures.push(`${label}: 警长未替换为无圆底六角星`);
      const cover = seat.querySelector<HTMLElement>('.ww-death');
      if (!dead) {
        if (cover) failures.push(`${label}: 存活仍有死亡覆盖`);
        continue;
      }
      const img = cover?.querySelector('img');
      if (!cover || !img) { failures.push(`${label}: 未使用死亡图片`); continue; }
      try { await img.decode(); } catch { failures.push(`${label}: 图片加载失败`); }
      if (img.naturalWidth !== img.naturalHeight || !img.naturalWidth) failures.push(`${label}: 图片非正方形`);
      const a = seat.getBoundingClientRect(), b = cover.getBoundingClientRect();
      if (['x', 'y', 'width', 'height'].some(key => Math.abs(a[key as keyof DOMRect] as number - (b[key as keyof DOMRect] as number)) > 0.5)) failures.push(`${label}: 覆盖层未铺满头像和原外框`);
      const frame = getComputedStyle(cover, '::after');
      if (frame.borderTopColor !== 'rgb(0, 0, 0)' || frame.borderTopWidth !== '2px') failures.push(`${label}: 状态边框不是2px纯黑`);
      if (getComputedStyle(seat).borderTopWidth !== '0px') failures.push(`${label}: 旧头像边框仍占位`);
      if (cover.textContent?.trim() || cover.querySelector('svg')) failures.push(`${label}: 残留旧文字/SVG`);
      if (getComputedStyle(cover).backgroundColor === 'rgba(0, 0, 0, 0)') failures.push(`${label}: 缺少不透明底色`);
      const number = seat.querySelector('.ww-seat-number')!;
      if (Number(getComputedStyle(number).zIndex) <= Number(getComputedStyle(cover).zIndex)) failures.push(`${label}: 座位号层级错误`);
      for (const badge of seat.querySelectorAll('.ww-corner')) {
        if (Number(getComputedStyle(badge).zIndex) <= Number(getComputedStyle(cover).zIndex)) failures.push(`${label}: 角标层级错误`);
      }
    }
    setResult(failures.length ? failures.join('\n') : `通过：${dead ? '六类死亡图片、全覆盖和角标层级' : '存活无死亡覆盖'}`);
  }
  return <main style={{ maxWidth: 760, margin: 'auto', padding: 16, color: '#efdbc3', background: '#213d40', fontFamily: 'sans-serif' }}>
    <h1>死亡头像验收</h1>
    <button onClick={() => setDead(value => !value)}>{dead ? '切为存活' : '切为死亡'}</button>{' '}
    <button onClick={verify}>检查覆盖与素材</button><pre style={{ whiteSpace: 'pre-wrap' }}>{result}</pre>
    {[60, 100].map(size => <section key={size}>
      <h2>{size}px头像</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px 12px', padding: '12px 0' }}>
        {kinds.map((death, index) => <div key={death} style={{ textAlign: 'center' }}>
          <div style={{ position: 'relative', width: size, height: size, margin: '0 auto 18px', containerType: 'inline-size' }}>
            <SeatAvatar seat={[1, 6, 10, 12, 5, 8][index]} death={dead ? death : null} sheriff={index === 0} identity={index === 2 ? '狼' : undefined} viewpoint={index === 5} selected={index === 1} active={index === 2} />
          </div><small>{deathNames[death]}</small>
        </div>)}
      </div>
    </section>)}
    <style>{`.ww-seat { position:relative; inset:auto; width:100%; height:100%; padding:0; border-width:4px; box-sizing:border-box; }`}</style>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
