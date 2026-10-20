import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'out',
      emptyOutDir: false,
      externalizeDeps: true,
      rollupOptions: {
        external: ['node-pty'],
        input: {
          'main/main': resolve(__dirname, 'src/main/main.ts'),
          'host/main': resolve(__dirname, 'src/host/main.ts'),
        },
        output: { entryFileNames: '[name].js', format: 'cjs' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { preload: resolve(__dirname, 'src/preload/preload.ts') },
        output: { entryFileNames: '[name].js', format: 'cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
