import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf('node_modules/phaser') !== -1 || id.indexOf('node_modules\\phaser') !== -1) {
            return 'phaser';
          }
          if (id.indexOf('node_modules') !== -1) {
            return 'vendor';
          }
        },
      },
    },
  },
});
