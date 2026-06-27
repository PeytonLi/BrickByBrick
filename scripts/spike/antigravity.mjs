// Spike (a) — THE HARD GATE: confirm the Antigravity Interactions API provisions
// a sandbox, runs a browser, and returns screenshots in `steps`. Captures the
// real response as the fixture the engine agent's screenshot parser builds on.
// Run: node scripts/spike/antigravity.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, ROOT } from './_env.mjs'

const env = loadEnv()
const key = env.GEMINI_API_KEY
if (!key) {
  console.error('✗ GEMINI_API_KEY missing in .env.local')
  process.exit(1)
}
const agent = env.ANTIGRAVITY_AGENT || 'antigravity-preview-05-2026'

const prompt = [
  'Create a file index.html containing a simple page with an <h1>Hello</h1> and a button.',
  'Start a static web server on port 3000 serving it.',
  'Open a browser to http://localhost:3000, resize the viewport to 375px wide,',
  'take a screenshot, and report whether the layout looks correct.',
].join(' ')

const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
  method: 'POST',
  headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
  body: JSON.stringify({
    agent,
    input: [{ type: 'text', text: prompt }],
    environment: { type: 'remote' },
  }),
})

console.log(`${res.ok ? '✓' : '✗'} POST /v1beta/interactions → ${res.status}`)
const text = await res.text()
if (!res.ok) {
  console.log('   ' + text.slice(0, 500))
  process.exit(1)
}

const data = JSON.parse(text)
const dir = join(ROOT, 'packages/inference/__fixtures__')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'interaction.sample.json'), JSON.stringify(data, null, 2))

const steps = data.steps || []
const hasShot = /screenshot|"image"|image\/png|data:image/i.test(JSON.stringify(steps))
console.log('   wrote packages/inference/__fixtures__/interaction.sample.json')
console.log('   environment_id:', data.environment_id)
console.log('   interaction id:', data.id)
console.log(`   steps: ${steps.length}; screenshot-bearing: ${hasShot ? 'YES ✓' : 'NO — inspect the fixture and adjust extractScreenshots()'}`)
if (!hasShot) process.exit(2)
