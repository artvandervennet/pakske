import { UPLOAD_MAX_BYTES } from './uploads'

const SMALL_BODY = 16 * 1024

/**
 * Whether a request's body is refused before any of it is read: 413 when it is too large, 411
 * when it doesn't say how large it is and so could be any size, null when it may be read. Only
 * the picture upload may be bigger than a small form. A POST, PUT or PATCH always has to state
 * its length; any other method, such as the DELETE that carries a password, only when it sends
 * a body at all.
 */
export function bodyRefusal(method: string, path: string, contentLength: string | undefined, transferEncoding: string | undefined): 411 | 413 | null {
  if (contentLength === undefined) {
    return ['POST', 'PUT', 'PATCH'].includes(method) || transferEncoding !== undefined ? 411 : null
  }
  const limit = path.endsWith('/image') ? UPLOAD_MAX_BYTES + 64 * 1024 : SMALL_BODY
  const length = Number(contentLength)
  return !Number.isFinite(length) || length > limit ? 413 : null
}
