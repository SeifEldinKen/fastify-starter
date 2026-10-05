import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts'],
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  // Keep .js output so `node dist/main.js` works ("type": "module")
  fixedExtension: false,
  sourcemap: true,
  // App server, not a library: no type declarations needed
  dts: false,
  clean: true,
})
