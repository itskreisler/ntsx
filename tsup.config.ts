import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'ntsx': 'src/index.ts' },
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: false,
  outDir: 'dist',
  noExternal: ['commander', 'zod'],
})