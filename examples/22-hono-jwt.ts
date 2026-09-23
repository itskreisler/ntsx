import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { SignJWT, jwtVerify } from 'jose'

const app = new Hono()
const secret = new TextEncoder().encode('benchmark-secret')

app.post('/login', async (c) => {
  const user = { id: '1', name: 'Kreisler' }
  const access = await new SignJWT({ ...user, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret)
  const refresh = await new SignJWT({ ...user, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
  return c.json({ access_token: access, refresh_token: refresh })
})

app.get('/me', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'missing_token' }, 401)
  try {
    return c.json((await jwtVerify(token, secret)).payload)
  } catch {
    return c.json({ error: 'invalid_token' }, 401)
  }
})

console.log('hono-jwt module initialized')
