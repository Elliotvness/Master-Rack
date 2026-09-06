import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { alias } from '../../vitest.alias.js';

/**
 * The studio bundle.
 *
 * `alias` is imported from the one table rather than restated here. Blueprint
 * §6.4 and `vitest.alias.ts` both say the table must agree across tsconfig,
 * the test runner and the bundler — and until this file existed there WAS no
 * bundler, so the third leg of that agreement was theoretical. Importing the
 * table means the bundler leg cannot drift by construction; `check-aliases`
 * covers the tsconfig leg, which is a separate file in a separate language and
 * genuinely can.
 *
 * Route-level code splitting is blueprint §5.4's decision, taken before there
 * were routes to split: each view is a lazily-loaded chunk, and the 200 KB
 * gzipped ceiling applies to the INITIAL payload — the shell plus the first
 * route — not to the sum of all chunks.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  build: {
    outDir: 'dist',
    // Vite defaults to esbuild minification; stated rather than assumed because
    // the budget checker weighs what this produces.
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        /*
         * Deterministic chunk names. The default hash is content-derived and
         * therefore stable, but the budget checker resolves the initial payload
         * by reading the script tags out of `dist/index.html`, and a readable
         * name makes a budget failure legible in CI ("studio-plan grew by 40 KB"
         * rather than "chunk-A7f2 grew by 40 KB").
         */
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
