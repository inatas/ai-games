import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ root: resolve('apps/web'), build: { outDir: resolve('dist'), emptyOutDir: true } });
