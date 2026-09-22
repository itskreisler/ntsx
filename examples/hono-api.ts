import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

app.get('/', (c) => c.json({ hello: 'world', via: 'ntsx' }))
app.get('/time', (c) => c.json({ now: new Date().toISOString() }))

const port = 3001
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Hono en http://localhost:${info.port}`)
})