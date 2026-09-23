import argv2Object from 'argv2object'

try {
  const args = argv2Object(true)
  console.log(JSON.stringify(args))
} catch (err: any) {
  console.log(JSON.stringify({ error: err.message }))
}
