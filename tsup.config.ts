import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'ntx': 'src/index.ts' },
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: false,
  outDir: 'dist',
})