import QRCode from 'qrcode'

;(async () => {
  const url = process.argv[2] ?? 'https://npmjs.com/package/@kreisler/ntsx'
  // terminal: imprime un QR directamente en la consola (escanea con el móvil)
  console.log(`QR para ${url}\n`)
  const qr = await QRCode.toString(url, { type: 'terminal', small: true })
  console.log(qr)
})()