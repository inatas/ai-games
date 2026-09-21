if (window.location.pathname === '/werewolf') {
  document.title = '狼人杀 · 无模型观战';
  const [{ createRoot }, { default: WerewolfRoom }] = await Promise.all([import('react-dom/client'), import('./werewolf/room.tsx')]);
  createRoot(document.getElementById('root')!).render(<WerewolfRoom />);
} else {
  await import('./mud.tsx');
}
export {};
