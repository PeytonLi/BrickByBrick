import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@brickbybrick/core',
    '@brickbybrick/db',
    '@brickbybrick/inference',
    '@brickbybrick/trainer',
  ],
  // Keep mongoose/mongodb out of the bundle — require them at runtime. This
  // avoids bundling the huge driver (and its optional 'aws4' dep warning) into
  // the API routes, which also speeds up dev cold-compile of the SSE routes.
  serverExternalPackages: ['@livekit/rtc-node', 'mongoose', 'mongodb'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
}

export default nextConfig
