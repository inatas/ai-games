if (window.location.pathname === '/werewolf') {
  document.title = '狼人杀 · Robot观战';
  const [{ createRoot }, { default: WerewolfRoom }] = await Promise.all([import('react-dom/client'), import('../../../mods/werewolf/web/room.tsx')]);
  createRoot(document.getElementById('root')!).render(<WerewolfRoom />);
} else {
  await import('../../../mods/qingxi/web/mud.tsx');
}
export {};
