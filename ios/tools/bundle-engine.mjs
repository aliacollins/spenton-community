import { build } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
await build({ root, configFile: false, publicDir: false, build: {
  target: 'es2020', minify: false, emptyOutDir: true,
  outDir: root + 'ios/SpentOn/Sources/Core/Resources',
  lib: { entry: root + 'ios/bridge/engine.ts', name: 'SpentOnEngine', formats: ['iife'], fileName: () => 'engine.js' },
} });
