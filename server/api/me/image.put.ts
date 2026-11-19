import { setPicture } from '../../domain/users'

// The person's profile picture, which their friends are shown. The address ends in /image, so
// the body may be as large as a picture is allowed to be (see `bodyRefusal`).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  // The middleware already refused a body over the limit before it was read.
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'image')
  if (!file || file.data.length === 0) fail(422, 'invalid_image')
  if (file.data.length > UPLOAD_MAX_BYTES) fail(413, 'too_large')
  const ext = sniffImage(file.data)
  if (!ext) fail(422, 'invalid_image')

  const name = await saveUpload(file.data, ext)
  let unused: string[]
  try {
    unused = domain(() => setPicture(useDb(), user.id, name)).unused
  }
  catch (error) {
    await removeUpload(name)
    throw error
  }
  // The row points at the new file now. Failing to clean up the old one must not undo that.
  await removeUploads(unused)
  return { picture: `/uploads/${name}` }
})
