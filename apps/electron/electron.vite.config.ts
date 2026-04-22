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
          index: resolve('src/core/index.ts'),
          'capibara-worker': resolve('src/core/modules/execution/workers/worker.ts'),
          'capibara-mcp-bridge': resolve('src/core/modules/mcp/bridge/capibara-mcp-bridge.ts'),
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
          index: resolve('src/core/preload/index.ts'),
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
        '@core': resolve('src/core'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
