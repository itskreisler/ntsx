import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { runCliWithRetry, sandbox } from '../helpers.mjs'

test('script metadata: JSDoc @ntsx sin metadata adicional', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'empty-ntsx.ts')
  const code = `/**
 * @ntsx
 */
console.log('empty-ntsx-ok')`
  writeFileSync(scriptPath, code, 'utf8')
  try {
    const out = runCliWithRetry(['run', scriptPath], { cwd: dir })
    assert.match(out, /empty-ntsx-ok/)
  } finally {
    try { unlinkSync(scriptPath) } catch {}
  }
})

test('script metadata: JSDoc @ntsx con @with sin versión y con versión', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'with-ntsx.ts')
  const code = `/**
 * @ntsx
 * @with chalk
 * @with zod@3.22.4
 */
import chalk from 'chalk';
import { z } from 'zod';
console.log('jsdoc-with-ok', typeof chalk.green, typeof z.string);
`
  writeFileSync(scriptPath, code, 'utf8')
  try {
    const out = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
    assert.match(out, /jsdoc-with-ok function function/)
  } finally {
    try { unlinkSync(scriptPath) } catch {}
  }
})

test('script metadata: JSDoc @ntsx con @node {24.21.0} y @runtime {tsx}', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'node-ntsx.ts')
  const code = `/**
 * @ntsx
 * @node {24.21.0}
 * @runtime {tsx}
 */
console.log('jsdoc-node-ok', process.version);
`
  writeFileSync(scriptPath, code, 'utf8')
  try {
    const out = runCliWithRetry(['run', '-q', scriptPath], { cwd: dir })
    assert.match(out, /jsdoc-node-ok v24\.21\.0/)
  } finally {
    try { unlinkSync(scriptPath) } catch {}
  }
})

test('script metadata: JSDoc normal no activa metadata @ntsx', () => {
  const dir = sandbox()
  const scriptPath = path.join(dir, 'normal-jsdoc.ts')
  const code = `/**
 * @param {string} value
 * @returns {string}
 */
console.log('normal-jsdoc-ok');
`
  writeFileSync(scriptPath, code, 'utf8')
  try {
    const out = runCliWithRetry(['run', scriptPath], { cwd: dir })
    assert.match(out, /normal-jsdoc-ok/)
  } finally {
    try { unlinkSync(scriptPath) } catch {}
  }
})
