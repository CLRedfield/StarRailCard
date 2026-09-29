import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_URL || './',
  define: { global: 'globalThis' },
  server: { port: 5177 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1000, rollupOptions: { output: { manualChunks: { three: ['three'], mqtt: ['mqtt'], react: ['react', 'react-dom'] } } } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
