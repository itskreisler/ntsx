import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCliWithRetry } from '../helpers.mjs'

test('inline package 01: axios', () => {
  const out = runCliWithRetry(['run', '--with', 'axios', '-q', '-e', "import axios from 'axios'; console.log('axios', typeof axios.get)"])
  assert.match(out, /axios function/)
})

test('inline package 02: chalk', () => {
  const out = runCliWithRetry(['run', '--with', 'chalk', '-q', '-e', "import chalk from 'chalk'; console.log('chalk', typeof chalk.green)"])
  assert.match(out, /chalk function/)
})

test('inline package 03: lodash', () => {
  const out = runCliWithRetry(['run', '--with', 'lodash', '-q', '-e', "import _ from 'lodash'; console.log('lodash', _.capitalize('hello'))"])
  assert.match(out, /lodash Hello/)
})

test('inline package 04: dayjs', () => {
  const out = runCliWithRetry(['run', '--with', 'dayjs', '-q', '-e', "import dayjs from 'dayjs'; console.log('dayjs', dayjs().isValid())"])
  assert.match(out, /dayjs true/)
})

test('inline package 05: uuid', () => {
  const out = runCliWithRetry(['run', '--with', 'uuid', '-q', '-e', "import { v4 } from 'uuid'; console.log('uuid', typeof v4)"])
  assert.match(out, /uuid function/)
})

test('inline package 06: nanoid', () => {
  const out = runCliWithRetry(['run', '--with', 'nanoid', '-q', '-e', "import { nanoid } from 'nanoid'; console.log('nanoid', typeof nanoid)"])
  assert.match(out, /nanoid function/)
})

test('inline package 07: zod', () => {
  const out = runCliWithRetry(['run', '--with', 'zod', '-q', '-e', "import { z } from 'zod'; console.log('zod', z.string().parse('ok'))"])
  assert.match(out, /zod ok/)
})

test('inline package 08: commander', () => {
  const out = runCliWithRetry(['run', '--with', 'commander', '-q', '-e', "import { Command } from 'commander'; console.log('commander', typeof Command)"])
  assert.match(out, /commander function/)
})

test('inline package 09: ora', () => {
  const out = runCliWithRetry(['run', '--with', 'ora', '-q', '-e', "import ora from 'ora'; console.log('ora', typeof ora)"])
  assert.match(out, /ora function/)
})

test('inline package 10: p-limit', () => {
  const out = runCliWithRetry(['run', '--with', 'p-limit', '-q', '-e', "import pLimit from 'p-limit'; console.log('p-limit', typeof pLimit)"])
  assert.match(out, /p-limit function/)
})

test('inline package 11: execa', () => {
  const out = runCliWithRetry(['run', '--eval-runtime', 'node', '--with', 'execa', '-q', '-e', "import { execa } from 'execa'; console.log('execa', typeof execa)"])
  assert.match(out, /execa function/)
})

test('inline package 12: glob', () => {
  const out = runCliWithRetry(['run', '--with', 'glob', '-q', '-e', "import { glob } from 'glob'; console.log('glob', typeof glob)"])
  assert.match(out, /glob function/)
})

test('inline package 13: minimist', () => {
  const out = runCliWithRetry(['run', '--with', 'minimist', '-q', '-e', "import minimist from 'minimist'; console.log('minimist', typeof minimist)"])
  assert.match(out, /minimist function/)
})

test('inline package 14: yaml', () => {
  const out = runCliWithRetry(['run', '--with', 'yaml', '-q', '-e', "import YAML from 'yaml'; console.log('yaml', typeof YAML.parse)"])
  assert.match(out, /yaml function/)
})

test('inline package 15: semver', () => {
  const out = runCliWithRetry(['run', '--with', 'semver', '-q', '-e', "import semver from 'semver'; console.log('semver', semver.valid('1.0.0'))"])
  assert.match(out, /semver 1.0.0/)
})

test('inline package 16: dotenv', () => {
  const out = runCliWithRetry(['run', '--with', 'dotenv', '-q', '-e', "import dotenv from 'dotenv'; console.log('dotenv', typeof dotenv.config)"])
  assert.match(out, /dotenv function/)
})

test('inline package 17: ms', () => {
  const out = runCliWithRetry(['run', '--with', 'ms', '-q', '-e', "import ms from 'ms'; console.log('ms', typeof ms)"])
  assert.match(out, /ms function/)
})

test('inline package 18: mime-types', () => {
  const out = runCliWithRetry(['run', '--with', 'mime-types', '-q', '-e', "import mime from 'mime-types'; console.log('mime-types', mime.lookup('json'))"])
  assert.match(out, /mime-types application\/json/)
})

test('inline package 19: qs', () => {
  const out = runCliWithRetry(['run', '--with', 'qs', '-q', '-e', "import qs from 'qs'; console.log('qs', typeof qs.stringify)"])
  assert.match(out, /qs function/)
})

test('inline package 20: jsonwebtoken', () => {
  const out = runCliWithRetry(['run', '--with', 'jsonwebtoken', '-q', '-e', "import jwt from 'jsonwebtoken'; console.log('jsonwebtoken', typeof jwt.sign)"])
  assert.match(out, /jsonwebtoken function/)
})
