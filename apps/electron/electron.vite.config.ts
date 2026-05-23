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
          'capibara-mcp-server': resolve('src/core/modules/acp/mcp/capibara-mcp-server.ts'),
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
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
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
