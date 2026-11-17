import { mkdirSync } from 'node:fs'

// Runs once when the server starts: refuse to run without a real secret, then open the
// database, which also applies any new migrations, and make sure the uploads folder exists.
export default defineNitroPlugin(() => {
  const secret = useRuntimeConfig().appSecret
  if (!import.meta.dev && (typeof secret !== 'string' || secret.length < 32)) {
    console.error('[wishlist] NUXT_APP_SECRET is missing or shorter than 32 characters. Set it to the output of `openssl rand -base64 32`.')
    process.exit(1)
  }
  useDb()
  mkdirSync(uploadsDir(), { recursive: true })
})
