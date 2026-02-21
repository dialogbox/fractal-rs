import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { execSync } from 'child_process';

const commitHash = execSync('git rev-parse --short HEAD').toString().trim();

export default defineConfig({
  base: './',
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  plugins: [wasm(), topLevelAwait()],
  server: {
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..'],
    },
  },
});
