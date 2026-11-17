/**
 * Scales a picture down to at most `max` pixels on its longest side and re-encodes it as JPEG,
 * in the browser, before it is uploaded. A phone photo of several megabytes becomes a few
 * hundred kilobytes, and re-encoding drops the metadata a camera adds, such as the location.
 */
export async function resizeImage(file: Blob, max = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  // JPEG has no transparency: put white behind a see-through PNG.
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The picture could not be encoded.'))), 'image/jpeg', quality)
  })
}
