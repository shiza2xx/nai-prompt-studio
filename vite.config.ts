import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  // Catalog packs are release assets, intentionally absent from CI and far too
  // large to copy into a quality-only browser build.
  publicDir: mode === 'ci' ? false : 'public',
  server: {
    watch: {
      ignored: ['**/.app-data/**', '**/.local-cache/**', '**/.qa-artifacts/**']
    }
  }
}));
