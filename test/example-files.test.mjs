import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sandbox, runCliWithRetry } from './helpers.mjs'

function runExample(file, withFlags) {
  const dir = sandbox()
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  const scriptPath = path.join(dir, path.basename(file))
  writeFileSync(scriptPath, readFileSync(file, 'utf8'))
  return runCliWithRetry(['run', ...withFlags, '-q', scriptPath], { cwd: dir })
}

test('example file 01: 01-axios.ts', () => {
  const out = runExample('examples/01-axios.ts', ['--with', 'axios'])
  assert.match(out, /01-axios: function/)
})

test('example file 02: 02-chalk.ts', () => {
  const out = runExample('examples/02-chalk.ts', ['--with', 'chalk'])
  assert.match(out, /02-chalk: function/)
})

test('example file 03: 03-lodash.ts', () => {
  const out = runExample('examples/03-lodash.ts', ['--with', 'lodash'])
  assert.match(out, /03-lodash: Hello/)
})

test('example file 04: 04-dayjs.ts', () => {
  const out = runExample('examples/04-dayjs.ts', ['--with', 'dayjs'])
  assert.match(out, /04-dayjs: true/)
})

test('example file 05: 05-uuid.ts', () => {
  const out = runExample('examples/05-uuid.ts', ['--with', 'uuid'])
  assert.match(out, /05-uuid: function/)
})

test('example file 06: 06-nanoid.ts', () => {
  const out = runExample('examples/06-nanoid.ts', ['--with', 'nanoid'])
  assert.match(out, /06-nanoid: function/)
})

test('example file 07: 07-zod.ts', () => {
  const out = runExample('examples/07-zod.ts', ['--with', 'zod'])
  assert.match(out, /07-zod: hello/)
})

test('example file 08: 08-commander.ts', () => {
  const out = runExample('examples/08-commander.ts', ['--with', 'commander'])
  assert.match(out, /08-commander: function/)
})

test('example file 09: 09-ora.ts', () => {
  const out = runExample('examples/09-ora.ts', ['--with', 'ora'])
  assert.match(out, /09-ora: function/)
})

test('example file 10: 10-p-limit.ts', () => {
  const out = runExample('examples/10-p-limit.ts', ['--with', 'p-limit'])
  assert.match(out, /10-p-limit: function/)
})

test('example file 11: 11-execa.ts', () => {
  const out = runExample('examples/11-execa.ts', ['--with', 'execa'])
  assert.match(out, /11-execa: function/)
})

test('example file 12: 12-glob.ts', () => {
  const out = runExample('examples/12-glob.ts', ['--with', 'glob'])
  assert.match(out, /12-glob: function/)
})

test('example file 13: 13-minimist.ts', () => {
  const out = runExample('examples/13-minimist.ts', ['--with', 'minimist'])
  assert.match(out, /13-minimist: function/)
})

test('example file 14: 14-yaml.ts', () => {
  const out = runExample('examples/14-yaml.ts', ['--with', 'yaml'])
  assert.match(out, /14-yaml: function/)
})

test('example file 15: 15-semver.ts', () => {
  const out = runExample('examples/15-semver.ts', ['--with', 'semver'])
  assert.match(out, /15-semver: function/)
})

test('example file 16: 16-dotenv.ts', () => {
  const out = runExample('examples/16-dotenv.ts', ['--with', 'dotenv'])
  assert.match(out, /16-dotenv: function/)
})

test('example file 17: 17-ms.ts', () => {
  const out = runExample('examples/17-ms.ts', ['--with', 'ms'])
  assert.match(out, /17-ms: function/)
})

test('example file 18: 18-mime-types.ts', () => {
  const out = runExample('examples/18-mime-types.ts', ['--with', 'mime-types'])
  assert.match(out, /18-mime-types: application\/json/)
})

test('example file 19: 19-qs.ts', () => {
  const out = runExample('examples/19-qs.ts', ['--with', 'qs'])
  assert.match(out, /19-qs: function/)
})

test('example file 20: 20-jsonwebtoken.ts', () => {
  const out = runExample('examples/20-jsonwebtoken.ts', ['--with', 'jsonwebtoken'])
  assert.match(out, /20-jsonwebtoken: function/)
})

test('complex inline stack 01: express + axios + cors + multer + zod', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run',
    '--with', 'express',
    '--with', 'axios',
    '--with', 'cors',
    '--with', 'multer',
    '--with', 'zod',
    '-q',
    '-e',
    "import express from 'express'; import axios from 'axios'; import cors from 'cors'; import multer from 'multer'; import { z } from 'zod'; console.log('stack-ok', typeof express, typeof axios.get, typeof cors, typeof multer, typeof z)"
  ], { cwd: dir })
  assert.match(out, /stack-ok function function function function object/)
})

test('complex inline stack 02: hono + jose', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run',
    '--with', 'hono',
    '--with', 'jose',
    '-q',
    '-e',
    "import { Hono } from 'hono'; import { SignJWT } from 'jose'; console.log('hono-jose-ok', typeof Hono, typeof SignJWT)"
  ], { cwd: dir })
  assert.match(out, /hono-jose-ok function function/)
})

test('complex inline stack 03: axios + otpauth + qrcode', () => {
  const dir = sandbox()
  const out = runCliWithRetry([
    'run',
    '--with', 'axios',
    '--with', 'otpauth',
    '--with', 'qrcode',
    '-q',
    '-e',
    "import axios from 'axios'; import OTPAuth from 'otpauth'; import QRCode from 'qrcode'; const secret = OTPAuth.Secret.fromBase32('JBSWY3DPEHPK3PXP'); const totp = new OTPAuth.TOTP({ issuer: 'ntsx', label: 'test', secret }); console.log('totp-qr-ok', typeof totp.generate, typeof QRCode.toDataURL)"
  ], { cwd: dir })
  assert.match(out, /totp-qr-ok function function/)
})

test('example file 21: 21-express-stack.ts', () => {
  const out = runExample('examples/21-express-stack.ts', ['--with', 'express', '--with', 'axios', '--with', 'cors', '--with', 'multer', '--with', 'zod'])
  assert.match(out, /express-stack module initialized/)
})

test('example file 22: 22-hono-jwt.ts', () => {
  const out = runExample('examples/22-hono-jwt.ts', ['--with', 'hono', '--with', '@hono/node-server', '--with', 'jose'])
  assert.match(out, /hono-jwt module initialized/)
})

test('example file 23: 23-otpauth-qr.ts', () => {
  const out = runExample('examples/23-otpauth-qr.ts', ['--with', 'axios', '--with', 'otpauth', '--with', 'qrcode'])
  assert.match(out, /totp code:.*qr generated:/s)
})
