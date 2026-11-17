import { randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const UPLOAD_MAX_BYTES = 3 * 1024 * 1024
export const UPLOAD_NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/

export const UPLOAD_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const
export type UploadExt = keyof typeof UPLOAD_TYPES

export function uploadsDir(): string {
  return join(useRuntimeConfig().dataDir, 'uploads')
}

/** The image type, read from the first bytes of the file. The name and the browser's claim are ignored. */
export function sniffImage(data: Buffer): UploadExt | null {
  if (data.length >= 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return 'jpg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

/** Writes the image under a random name and returns that name. */
export async function saveUpload(data: Buffer, ext: UploadExt): Promise<string> {
  const name = `${randomBytes(16).toString('hex')}.${ext}`
  await mkdir(uploadsDir(), { recursive: true })
  await writeFile(join(uploadsDir(), name), data, { flag: 'wx' })
  return name
}

export async function removeUpload(name: string | null): Promise<void> {
  if (name && UPLOAD_NAME.test(name)) await rm(join(uploadsDir(), name), { force: true })
}
