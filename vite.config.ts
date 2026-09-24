import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve('apps/web'),
  server: { proxy: {
    '/api/werewolf': { target: 'http://127.0.0.1:4318', changeOrigin: false },
    '/api/robot-users': 'http://127.0.0.1:4318',
    '/robot-assets': 'http://127.0.0.1:4318',
  } },
  build: { outDir: resolve('dist'), emptyOutDir: true },
});
