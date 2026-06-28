import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function loadEnv() {
  const env = { ...process.env }
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return env
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match && !env[match[1]]) env[match[1]] = match[2]
  }
  return env
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

async function checkGemini(env) {
  const model = env.WEAK_MODEL || 'gemma-4-26b-a4b-it'
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini weak model smoke failed: ${res.status}`)
}

async function checkHuggingFace(env) {
  const model = env.BBB_GEMMA_MODEL || 'google/gemma-4-26B-A4B-it'
  const res = await fetch(`https://huggingface.co/api/models/${model}`, {
    headers: { authorization: `Bearer ${env.HF_TOKEN}` },
  })
  if (!res.ok) throw new Error(`Hugging Face model access failed for ${model}: ${res.status}`)
}

function checkLiveKit(env) {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: env.LIVEKIT_API_KEY,
    sub: 'preflight',
    nbf: now,
    exp: now + 60,
    video: { room: 'bbb-preflight', roomJoin: true },
  }
  const input = `${b64(header)}.${b64(payload)}`
  createHmac('sha256', env.LIVEKIT_API_SECRET).update(input).digest('base64url')
}

async function main() {
  const env = loadEnv()
  const required = [
    'GEMINI_API_KEY',
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'PRIME_API_KEY',
    'HF_TOKEN',
  ]
  for (const key of required) {
    if (!env[key]) throw new Error(`${key} is missing`)
  }

  run('prime', ['--version'], env)
  const availability = JSON.parse(
    run('prime', ['--plain', 'availability', 'list', '--gpu-type', 'H100_80GB', '--output', 'json'], env),
  )
  if (!availability.gpu_resources?.length) throw new Error('No H100_80GB capacity visible')

  const keyPath = env.PRIME_SSH_KEY_PATH || join(homedir(), '.ssh', 'id_rsa')
  if (!existsSync(keyPath)) throw new Error(`Prime SSH key missing at ${keyPath}`)

  await checkGemini(env)
  await checkHuggingFace(env)
  checkLiveKit(env)

  console.log('preflight ok')
  console.log(`h100 options: ${availability.gpu_resources.length}`)
  console.log(`ssh key: ${keyPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
