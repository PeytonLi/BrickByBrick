import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  transpilePackages: [
    '@brickbybrick/core',
    '@brickbybrick/inference',
    '@brickbybrick/trainer',
  ],
  outputFileTracingRoot: path.join(__dirname, '../../'),
}

export default nextConfig
