import mongoose from 'mongoose'

declare global {
  var __bbbMongoose: Promise<typeof mongoose> | undefined
}

export function connectDB(): Promise<typeof mongoose> {
  if (globalThis.__bbbMongoose) return globalThis.__bbbMongoose
  const uri = process.env.MONGODB_ATLAS_URI
  if (!uri) throw new Error('MONGODB_ATLAS_URI is not set')
  globalThis.__bbbMongoose = mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME || 'brickbybrick',
  })
  return globalThis.__bbbMongoose
}

export async function disconnectDB(): Promise<void> {
  if (globalThis.__bbbMongoose) {
    const m = await globalThis.__bbbMongoose
    await m.disconnect()
    delete globalThis.__bbbMongoose
  }
}
