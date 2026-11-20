import { picturesInUse, purge } from '../domain/purge'

const DAY = 24 * 60 * 60 * 1000

// What the site promises to forget, it forgets here. Once a day: erase the lists and wishes that
// were deleted long enough ago that nobody is shown them any more, and the links that ended,
// then the picture files nothing points at. Every minute: the counters of wrong passwords and new
// accounts whose window is over, which hold an IP address or a typed email address. The privacy
// page says an hour at most, and the longest window is an hour.
export default defineNitroPlugin((nitro) => {
  const daily = async () => {
    try {
      const db = useDb()
      await removeUploads(purge(db).unused)
      await sweepUploads(picturesInUse(db))
    }
    catch (error) {
      // The message only: an error object can carry the rows it was about.
      console.error('[pakske] cleanup failed:', error instanceof Error ? error.message : 'unknown error')
    }
  }
  // Not at the very start: a restart loop must not run it over and over.
  const first = setTimeout(daily, 60 * 1000)
  const every = setInterval(daily, DAY)
  const counters = setInterval(() => sweepHits(), 60 * 1000)
  // None of them keeps the server from stopping.
  for (const timer of [first, every, counters]) timer.unref()
  nitro.hooks.hook('close', () => {
    clearTimeout(first)
    clearInterval(every)
    clearInterval(counters)
  })
})
