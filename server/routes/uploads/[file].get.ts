import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

// Serves an uploaded image. The name is random and never reused, so a browser may keep it for
// good. Only a browser: a cache in between (a proxy, a tunnel's edge) would go on handing out a
// picture after it was deleted here, hence `private`.
export default defineEventHandler(async (event) => {
  const name = String(getRouterParam(event, 'file'))
  const match = UPLOAD_NAME.exec(name)
  if (!match) fail(404, 'not_found')

  const path = join(uploadsDir(), name)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) fail(404, 'not_found')

  setResponseHeader(event, 'Content-Type', UPLOAD_TYPES[match[1] as UploadExt])
  setResponseHeader(event, 'Content-Length', info.size)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=31536000, immutable')
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'")
  return sendStream(event, createReadStream(path))
})
