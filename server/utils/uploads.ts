import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
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

/**
 * Removes files nothing points at any more. Never throws: the change that freed them is already
 * saved, and a file left behind costs only disk space.
 */
export async function removeUploads(names: string[]): Promise<void> {
  await Promise.all(names.map(name => removeUpload(name).catch(() => {})))
}

/** How old a file must be before the sweep may take it: one just uploaded has no row yet. */
const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Removes the pictures in the uploads folder that nothing points at: `inUse` holds every name a
 * row still has. Removing a file can fail and leave it behind (`removeUploads`); this is what
 * picks those up. Only files this site named itself are looked at. Returns how many went.
 */
export async function sweepUploads(inUse: Set<string>, dir = uploadsDir(), now = Date.now()): Promise<number> {
  let removed = 0
  for (const name of await readdir(dir).catch(() => [])) {
    if (!UPLOAD_NAME.test(name) || inUse.has(name)) continue
    const info = await stat(join(dir, name)).catch(() => null)
    if (!info?.isFile() || now - info.mtimeMs < SWEEP_AFTER_MS) continue
    await rm(join(dir, name), { force: true })
    removed++
  }
  return removed
}
