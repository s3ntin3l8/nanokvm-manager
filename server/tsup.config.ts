import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Dependencies stay external and are installed in the runtime image via
  // `pnpm deploy --prod` (see Dockerfile).
  skipNodeModulesBundle: true,
});
