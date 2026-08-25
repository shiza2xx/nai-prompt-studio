import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    watch: {
      ignored: ['**/.app-data/**', '**/.local-cache/**', '**/.qa-artifacts/**']
    }
  }
});
