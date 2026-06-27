'use client'

import Image from 'next/image'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useMultibandTrackVolume,
  useTracks,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { CircleDot, Mic2, Radio, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { type AgentStoreSnapshot } from '@/lib/store'
import { cn } from '@/lib/utils'

interface LiveKitTokenPayload {
  token: string
  url: string
}

interface LiveMediaRoomProps {
  snapshot: AgentStoreSnapshot
  liveKitToken: LiveKitTokenPayload | null
  liveKitError: string | null
  onConnectLiveKit: () => void
}

export function LiveMediaRoom({
  snapshot,
  liveKitToken,
  liveKitError,
  onConnectLiveKit,
}: LiveMediaRoomProps) {
  return (
    <section
      aria-labelledby="live-media-room-title"
      className="grid gap-5 rounded-lg border border-white/10 bg-[#050608] p-4 shadow-2xl shadow-black/40 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]"
      data-testid="live-media-room"
    >
      <div className="flex min-h-[300px] flex-col justify-between rounded-md border border-emerald-300/20 bg-black p-4">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="live-media-room-title" className="text-lg font-semibold text-white">
                A - Live Media Room
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                LiveKit narration and visual audit frames.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-md border border-emerald-300/30 px-2 py-1 text-xs text-emerald-200">
              <CircleDot className="size-3" aria-hidden="true" />
              {snapshot.status}
            </span>
          </div>

          <div className="mt-5">
            {liveKitToken ? (
              <LiveKitRoom
                token={liveKitToken.token}
                serverUrl={liveKitToken.url}
                connect
                audio={false}
                video={false}
                className="contents"
              >
                <RoomAudioRenderer />
                <LiveKitNarrationVisualizer />
              </LiveKitRoom>
            ) : (
              <AgentAudioVisualizer />
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <Button variant="outline" onClick={onConnectLiveKit}>
            <Mic2 className="size-4" aria-hidden="true" />
            Connect audio room
          </Button>
          {liveKitError ? (
            <p className="text-xs leading-5 text-amber-200">{liveKitError}</p>
          ) : (
            <p className="text-xs leading-5 text-zinc-500">
              Token route stays server-side; the room connects only after this control is used.
            </p>
          )}
          <NarrationLog narration={snapshot.narration} />
        </div>
      </div>

      <div className="min-h-[300px] overflow-hidden rounded-md border border-white/10 bg-zinc-950">
        {snapshot.latestScreenshotSrc ? (
          <Image
            src={snapshot.latestScreenshotSrc}
            alt="Latest visual audit screenshot"
            width={1280}
            height={720}
            unoptimized
            className="h-full min-h-[300px] w-full object-contain"
          />
        ) : (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,#111827,#080a0d_45%,#0b1512)] p-6 text-center">
            <ShieldCheck className="size-10 text-emerald-300" aria-hidden="true" />
            <p className="max-w-sm text-sm leading-6 text-zinc-400">
              Audit screenshots will swap here on each audit_step event.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function LiveKitNarrationVisualizer() {
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true })
  const narratorTrack =
    tracks.find((track) => track.participant.identity.startsWith('narrator-')) ?? tracks[0]
  const levels = useMultibandTrackVolume(narratorTrack, {
    bands: 24,
    updateInterval: 80,
  })

  return <AgentAudioVisualizer connected={Boolean(narratorTrack)} levels={levels} />
}

export function AgentAudioVisualizer({
  connected = false,
  levels = [],
}: {
  connected?: boolean
  levels?: number[]
}) {
  return (
    <div
      className={cn(
        'grid h-24 grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-1 rounded-md border border-white/10 bg-zinc-950 p-3',
        connected && 'border-emerald-300/40',
      )}
      aria-label="Agent audio visualizer"
    >
      {Array.from({ length: 24 }, (_, index) => {
        const level = levels[index] ?? 0
        const isAudible = connected && level > 0.015

        return (
          <span
            key={index}
            className={cn(
              'rounded-t bg-zinc-700 transition-[height,background-color,opacity]',
              isAudible && 'bg-emerald-300',
            )}
            style={{
              height: connected
                ? `${Math.max(10, Math.min(100, 10 + level * 90))}%`
                : `${18 + ((index * 17) % 52)}%`,
              opacity: connected ? Math.max(0.35, Math.min(1, 0.35 + level * 1.8)) : 0.55,
            }}
          />
        )
      })}
    </div>
  )
}

export function NarrationLog({ narration }: { narration: string[] }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        <Radio className="size-3" aria-hidden="true" />
        Narration
      </div>
      <div className="space-y-2">
        {(narration.length > 0 ? narration : ['No narration events yet.']).map(
          (line, index) => (
            <p key={`${line}-${index}`} className="text-xs leading-5 text-zinc-300">
              {line}
            </p>
          ),
        )}
      </div>
    </div>
  )
}
