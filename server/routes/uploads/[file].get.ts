import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

// Serves an uploaded image. The name is random and never reused, so browsers may keep it forever.
export default defineEventHandler(async (event) => {
  const name = String(getRouterParam(event, 'file'))
  const match = UPLOAD_NAME.exec(name)
  if (!match) fail(404, 'not_found')

  const path = join(uploadsDir(), name)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) fail(404, 'not_found')

  setResponseHeader(event, 'Content-Type', UPLOAD_TYPES[match[1] as UploadExt])
  setResponseHeader(event, 'Content-Length', info.size)
  setResponseHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'")
  return sendStream(event, createReadStream(path))
})
