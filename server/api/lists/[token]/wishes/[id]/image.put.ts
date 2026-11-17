import { setWishImage } from '../../../../../domain/wishes'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const token = tokenParam(event)
  const id = idParam(event)

  // The middleware already refused a body over the limit before it was read.
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'image')
  if (!file || file.data.length === 0) fail(422, 'invalid_image')
  if (file.data.length > UPLOAD_MAX_BYTES) fail(413, 'too_large')
  const ext = sniffImage(file.data)
  if (!ext) fail(422, 'invalid_image')

  const name = await saveUpload(file.data, ext)
  let previous: string | null
  try {
    previous = domain(() => setWishImage(useDb(), user.id, token, id, name)).previous
  }
  catch (error) {
    // The wish isn't theirs, isn't on this list, or is gone: don't keep the file.
    await removeUpload(name)
    throw error
  }
  // The row points at the new file now. Failing to clean up the old one must not undo that.
  await removeUpload(previous).catch(() => {})
  return { image: `/uploads/${name}` }
})
