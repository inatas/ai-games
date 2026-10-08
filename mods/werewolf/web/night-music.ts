import { useCallback, useEffect, useRef, useState } from 'react';

const preferenceKey = 'werewolf:night-music';
const musicVolume = .2;

export function shouldPlayNightMusic(enabled: boolean, visible: boolean, status: string, period: string, inLobby: boolean) {
  return enabled && visible && status === 'running' && period === 'night' && !inLobby;
}

export function nightMusicVolume(from: number, to: number, elapsed: number, duration: number) {
  return from + (to - from) * Math.min(1, Math.max(0, elapsed / duration));
}

export function announcementForKind(kind: string) {
  if (kind === 'night') return { src: '/werewolf/audio/night-announcement.mp3', text: '天黑了' };
  if (kind === 'day') return { src: '/werewolf/audio/day-announcement.mp3', text: '天亮了' };
  return null;
}

export function useNightMusic(status: string, period: string, inLobby: boolean) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(preferenceKey) === 'on');
  const [visible, setVisible] = useState(() => !document.hidden);
  const [blocked, setBlocked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ducked, setDucked] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const voice = useRef<HTMLAudioElement | null>(null);
  const spoken = useRef(new Set<string>());
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const frame = useRef(0);

  useEffect(() => {
    const music = new Audio('/werewolf/audio/night-music.mp3');
    music.loop = true;
    music.preload = 'none';
    music.volume = 0;
    audio.current = music;
    return () => {
      cancelAnimationFrame(frame.current);
      music.pause();
      voice.current?.pause();
      music.src = '';
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const music = audio.current;
    if (!music) return;
    cancelAnimationFrame(frame.current);
    const target = shouldPlayNightMusic(enabled, visible, status, period, inLobby) ? musicVolume * (ducked ? .35 : 1) : 0;
    if (target && music.paused) {
      void music.play().then(() => { if (!music.paused) { setBlocked(false); setPlaying(true); } }).catch(() => { setBlocked(true); setPlaying(false); });
    }
    if (!target && !visible) { music.volume = 0; music.pause(); setPlaying(false); return; }
    const from = music.volume;
    const duration = target ? ducked ? 250 : from > 0 ? 600 : 1200 : 1000;
    const start = performance.now();
    const fade = (now: number) => {
      const elapsed = now - start;
      music.volume = nightMusicVolume(from, target, elapsed, duration);
      if (elapsed < duration) frame.current = requestAnimationFrame(fade);
      else if (!target) { music.pause(); setPlaying(false); }
    };
    frame.current = requestAnimationFrame(fade);
    return () => cancelAnimationFrame(frame.current);
  }, [enabled, visible, status, period, inLobby, ducked]);

  const announce = useCallback((id: string, kind: string) => {
    const copy = announcementForKind(kind);
    if (!copy || spoken.current.has(id)) return;
    spoken.current.add(id);
    if (!enabledRef.current || document.hidden) return;
    voice.current?.pause();
    const clip = new Audio(copy.src);
    clip.volume = .8;
    voice.current = clip;
    setDucked(true);
    const finish = () => {
      if (voice.current === clip) { voice.current = null; setDucked(false); }
    };
    clip.onended = finish;
    clip.onerror = finish;
    void clip.play().catch(finish);
  }, []);

  const toggle = () => {
    const next = !enabled;
    localStorage.setItem(preferenceKey, next ? 'on' : 'off');
    setEnabled(next);
    setBlocked(false);
    if (!next) {
      const music = audio.current;
      if (music) { music.volume = 0; music.pause(); setPlaying(false); }
      voice.current?.pause();
      voice.current = null;
      setDucked(false);
    } else if (shouldPlayNightMusic(true, !document.hidden, status, period, inLobby)) {
      void audio.current?.play().then(() => { if (!audio.current?.paused) { setBlocked(false); setPlaying(true); } }).catch(() => { setBlocked(true); setPlaying(false); });
    }
  };

  return { enabled, blocked, playing, toggle, announce };
}
