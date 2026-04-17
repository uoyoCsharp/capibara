import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
        '@core': resolve('src/core'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'capibara-mcp-bridge': resolve('src/main/infrastructure/mcp/capibara-mcp-bridge.ts'),
          'capibara-worker': resolve('src/main/infrastructure/executors/worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@core': resolve('src/core'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs',
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
