/**
 * Package-local build for the Windows desktop tools: bundle the Node half
 * emitted by tsc under `lib/types` into `lib/index.js`. Peer packages stay
 * external, exactly as the root workspace build treats every host package.
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  name: '@deepseek-ai/dsh-tool-desktop',
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
