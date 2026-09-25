import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCli, runCliErr } from './helpers.mjs'

test('core CLI: eval por default usa tsx (soporta TS syntax)', () => {
  const out = runCli(['run', '-e', "type X = { a: number }; const o: X = { a: 42 }; console.log('inline-01', o.a)"])
  assert.match(out, /inline-01 42/)
})

test('core CLI: --eval-runtime node ejecuta con node nativo (top-level await)', () => {
  const out = runCli(['run', '--eval-runtime', 'node', '-e', 'await Promise.resolve(); console.log("node-native-ok")'])
  assert.match(out, /node-native-ok/)
})

test('core CLI: --eval-runtime inválido devuelve error limpio y exit != 0', () => {
  const { code, stderr } = runCliErr(['run', '--eval-runtime', 'bun', '-e', '1'])
  assert.notEqual(code, 0)
  assert.match(stderr, /tsx.*node/)
})

test('core CLI: sin script ni eval da error', () => {
  const { code, stderr } = runCliErr(['run'])
  assert.notEqual(code, 0)
  assert.match(stderr, /ntsx: .*required/i)
})

test('core CLI: script inexistente devuelve error limpio', () => {
  const { code, stderr } = runCliErr(['run', 'no-existe.ts'])
  assert.notEqual(code, 0)
  assert.match(stderr, /ntsx: Script not found/)
})

test('core CLI: --with con spec inválido devuelve error limpio', () => {
  const { code, stderr } = runCliErr(['run', '--with', 'INVALID SPEC!', '-e', '1'])
  assert.notEqual(code, 0)
  assert.match(stderr, /Invalid package spec/)
})

test('core CLI: --node ejecuta el script', () => {
  const out = runCli(['run', '--node', '22', '-e', 'console.log("node-reserved")'])
  assert.equal(out.trim(), 'node-reserved')
})

test('core CLI: cache stats funciona', () => {
  const out = runCli(['cache', 'stats'])
  assert.match(out, /Cache:.*\.cache[\\/]ntsx|No cache at/)
})

test('core CLI: cache clean pide confirmación (n aborta)', () => {
  const out = runCli(['cache', 'clean'], { input: 'n\n' })
  assert.match(out, /Aborted|Cache does not exist or is empty/)
})

test('core CLI: cache clean --force vacía el caché', () => {
  const out = runCli(['cache', 'clean', '--force'])
  assert.match(out, /Cache cleared|does not exist or is empty/)
})
