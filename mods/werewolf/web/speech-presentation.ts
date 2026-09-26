import type { DemoSnapshot } from '../shared/werewolf.ts';

export function speechKey(game: DemoSnapshot): string | null {
  const speech = game.currentSpeech;
  if (game.status !== 'running' || game.period !== 'day' || !speech?.text.trim() || speech.seat !== game.speakerSeat) return null;
  return `${game.id}:${speech.seat}:${speech.revision}`;
}

/** Percentages of the 1:2 board. The bubble may cover the clock, but stays above history. */
export function speechLayout(seat: number, measuredHeight: number) {
  const row = (seat - 1) % 6;
  const target = 17.55 + row * 9.85;
  const height = Math.min(32, Math.max(20, measuredHeight));
  const top = Math.max(13, Math.min(74 - height, target - height * .35));
  return { width: 56, top, height, maxHeight: 32, tail: target - top, tailOffset: 0, right: seat > 6 };
}

export function revealDuration(lines: number, remainingMs: number): number {
  return Math.min(12_000, Math.max(1, lines) * 700, Math.max(0, remainingMs - 400));
}

/** Keep previous lines visible while revealing the current visual line left to right. */
export function revealClip(elapsed: number, duration: number, lines: number, lineHeight: number): string {
  if (duration <= 0 || elapsed >= duration) return 'none';
  const progress = Math.max(0, elapsed / duration) * lines;
  const y = Math.floor(progress) * lineHeight;
  const x = (progress % 1) * 100;
  return `polygon(0 0,100% 0,100% ${y}px,${x}% ${y}px,${x}% ${y + lineHeight}px,0 ${y + lineHeight}px)`;
}
