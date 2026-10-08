import { createPortal } from 'react-dom';
import { useEffect, useRef, type CSSProperties } from 'react';
import { useRobotUsers } from './robot-context.tsx';
import { portraitStyle } from './seat-avatar.tsx';
import { resultCopy, type PresentationItem } from './presentation.ts';
import './result-overlay.css';

export function ResultOverlay({ item, onClose, reduced = false, peopleVisible = true, exiting = false, resumed = false, motionStyle }: { item: PresentationItem; onClose: () => void; reduced?: boolean; peopleVisible?: boolean; exiting?: boolean; resumed?: boolean; motionStyle?: CSSProperties }) {
  const users = useRobotUsers();
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  if (!item.result) return null;
  const copy = resultCopy[item.result];
  const transfer = item.result === 'badge-transfer';
  return createPortal(<section className="ww-result-overlay" data-exiting={exiting} data-reduced={reduced} data-resumed={resumed} style={motionStyle} role="dialog" aria-modal="true" aria-label={copy.title} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus(); }
  }}>
    <div className="ww-result-layout">
      <h2>{copy.title}</h2>
      <img className={`ww-result-art result-${item.result}`} src={`/werewolf/results/${copy.art}.png`} alt=""/>
      <div className="ww-result-people" hidden={!peopleVisible}>
        <div className={`ww-result-roster${transfer ? ' is-transfer' : ''}`}>
          {item.seats.map((seat, index) => <div className="ww-result-player" key={`${seat}:${index}`}>
            <span className="ww-result-portrait" style={portraitStyle(seat, users.find(player => player.seat === seat)?.user)} role="img" aria-label={`${seat}号玩家头像`}/>
            <b>{seat}号</b>
            {transfer && <small>{index === 0 ? '原警长' : '新警长'}</small>}
          </div>)}
        </div>
        {copy.detail && <p>{copy.detail}</p>}
      </div>
    </div>
    <button ref={closeButton} className="ww-result-close" onClick={onClose} aria-label="关闭当前结果">×</button>
  </section>, document.body);
}
