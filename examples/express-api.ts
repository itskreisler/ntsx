import express from 'express'
const app = express()
app.get('/', (_req, res) => res.json({ hello: 'world', via: 'ntx' }))
app.listen(3000, () => console.log('Express en http://localhost:3000'))
