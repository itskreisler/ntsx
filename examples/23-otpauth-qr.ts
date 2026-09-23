import axios from 'axios'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'

;(async () => {
  const { data } = await axios.get('https://api.github.com/repos/itskreisler/ntsx')
  const secret = OTPAuth.Secret.fromBase32('JBSWY3DPEHPK3PXP')
  const totp = new OTPAuth.TOTP({ issuer: 'ntsx', label: data.name, secret })
  console.log('totp code:', totp.generate())
  console.log('qr generated:', (await QRCode.toDataURL(totp.toString())).slice(0, 30))
})()
