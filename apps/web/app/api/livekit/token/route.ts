import { AccessToken } from 'livekit-server-sdk'
import { NextResponse } from 'next/server'

import type { LiveKitTokenRequest, LiveKitTokenResponse } from '@brickbybrick/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readEnv() {
  const url = process.env.LIVEKIT_URL
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET

  if (!url || !apiKey || !apiSecret) {
    return null
  }

  return { url, apiKey, apiSecret }
}

function normalizeRequest(input: unknown): LiveKitTokenRequest {
  const body = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const room = body.room ?? body.room_name
  const identity = body.identity ?? body.participant_identity

  return {
    room: typeof room === 'string' && room.length > 0 ? room : 'brickbybrick-control',
    identity:
      typeof identity === 'string' && identity.length > 0
        ? identity
        : `operator-${crypto.randomUUID().slice(0, 8)}`,
  }
}

async function mintToken(requestBody: unknown) {
  const env = readEnv()

  if (!env) {
    return NextResponse.json(
      { error: 'LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are required' },
      { status: 503 },
    )
  }

  const { room, identity } = normalizeRequest(requestBody)
  const token = new AccessToken(env.apiKey, env.apiSecret, {
    identity,
    name: identity,
    ttl: '10m',
  })

  token.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  })

  const response: LiveKitTokenResponse = {
    token: await token.toJwt(),
    url: env.url,
  }

  return NextResponse.json(response, { status: 201 })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  return mintToken({
    room: url.searchParams.get('room'),
    identity: url.searchParams.get('identity'),
  })
}

export async function POST(request: Request) {
  let body: unknown = {}

  try {
    body = await request.json()
  } catch {
    body = {}
  }

  return mintToken(body)
}
