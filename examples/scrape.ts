import { JSDOM } from 'jsdom'

// tsx transpila a CJS → evita top-level await; envuelve en IIFE async
;(async () => {
  const { default: axios } = await import('axios')
  const url = process.argv[2] ?? 'https://example.com'
  const { data } = await axios.get(url)
  const doc = new JSDOM(data).window.document
  const title = doc.querySelector('title')?.textContent?.trim() ?? '(sin title)'
  const h1 = doc.querySelector('h1')?.textContent?.trim() ?? '(sin h1)'
  const links = doc.querySelectorAll('a').length
  console.log(`title:  ${title}`)
  console.log(`h1:     ${h1}`)
  console.log(`links:  ${links}`)
})()