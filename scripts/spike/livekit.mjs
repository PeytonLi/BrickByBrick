// Spike (e): confirm LiveKit creds and that we can mint a valid join token.
// Dependency-free HS256 JWT (LiveKit access token). Full connection is validated
// later by the UI route. Run: node scripts/spike/livekit.mjs
import { createHmac } from 'node:crypto'
import { loadEnv } from './_env.mjs'

const env = loadEnv()
const { LIVEKIT_API_KEY: k, LIVEKIT_API_SECRET: s, LIVEKIT_URL: url } = env
if (!k || !s || !url) {
  console.error('✗ LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing in .env.local')
  process.exit(1)
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const header = { alg: 'HS256', typ: 'JWT' }
const payload = {
  iss: k,
  sub: 'spike',
  nbf: now,
  exp: now + 600,
  video: { room: 'bbb-spike', roomJoin: true, canPublish: true, canSubscribe: true },
}
const signingInput = `${b64(header)}.${b64(payload)}`
const sig = createHmac('sha256', s).update(signingInput).digest('base64url')

console.log('✓ minted LiveKit join token for', url)
console.log(`${signingInput}.${sig}`)
console.log('  (validate by joining room "bbb-spike" from the dashboard or LiveKit playground)')
