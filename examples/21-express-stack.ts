import express from 'express'
import axios from 'axios'
import cors from 'cors'
import multer from 'multer'
import { z } from 'zod'

const app = express()
const upload = multer({ storage: multer.memoryStorage() })
app.use(cors())
app.use(express.json())

const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

app.post('/upload', upload.single('file'), async (req, res) => {
  const data = schema.parse(req.body)
  const response = await axios.get('https://api.github.com/repos/itskreisler/ntsx')
  res.json({ data, file: req.file?.originalname, repo: response.data.full_name })
})

console.log('express-stack module initialized')
