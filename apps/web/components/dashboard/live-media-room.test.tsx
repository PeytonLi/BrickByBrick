/* eslint-disable @next/next/no-img-element */
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { initialAgentState, type AgentStoreSnapshot } from '@/lib/store'

import { LiveMediaRoom } from './live-media-room'

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt: string
    [key: string]: unknown
  }) => <img alt={alt} {...props} />,
}))

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: ReactNode }) => (
    <div data-testid="livekit-room">{children}</div>
  ),
  RoomAudioRenderer: () => <div data-testid="room-audio-renderer" />,
  useTracks: () => [
    {
      participant: { identity: 'narrator-test' },
    },
  ],
  useMultibandTrackVolume: () =>
    Array.from({ length: 24 }, (_, index) => (index % 2 === 0 ? 0.5 : 0.02)),
}))

function snapshot(overrides: Partial<AgentStoreSnapshot> = {}): AgentStoreSnapshot {
  return {
    ...initialAgentState,
    ...overrides,
  }
}

describe('LiveMediaRoom', () => {
  it('renders room audio and a track-backed narrator visualizer when connected', () => {
    render(
      <LiveMediaRoom
        snapshot={snapshot({ status: 'auditing' })}
        liveKitToken={{ token: 'token', url: 'wss://livekit.test' }}
        liveKitError={null}
        onConnectLiveKit={() => {}}
      />,
    )

    expect(screen.getByTestId('livekit-room')).toBeInTheDocument()
    expect(screen.getByTestId('room-audio-renderer')).toBeInTheDocument()
    expect(screen.getByLabelText('Agent audio visualizer')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Agent audio visualizer')[0].querySelectorAll('span')).toHaveLength(24)
  })
})
