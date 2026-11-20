// A small in-memory limiter. One server process, a handful of people: no store needed.
// Counters reset when the server restarts. A key can hold an IP address or a typed email address,
// so a counter whose window is over is dropped within minutes (server/plugins/03.cleanup.ts)
// and not only when its key is next used.

interface Bucket { count: number, resetAt: number }
const buckets = new Map<string, Bucket>()

function current(key: string, now: number): Bucket | undefined {
  const bucket = buckets.get(key)
  if (bucket && bucket.resetAt <= now) {
    buckets.delete(key)
    return undefined
  }
  return bucket
}

/** True when `key` has already been counted `limit` times in its window. */
export function isLimited(key: string, limit: number): boolean {
  return (current(key, Date.now())?.count ?? 0) >= limit
}

/** Counts one more for `key`. The window starts at the first count. */
export function countHit(key: string, windowMs: number): void {
  const now = Date.now()
  const bucket = current(key, now)
  if (bucket) bucket.count++
  else buckets.set(key, { count: 1, resetAt: now + windowMs })
  if (buckets.size > 5000) sweepHits(now)
}

/** Drops every counter whose window is over. Returns how many are left. */
export function sweepHits(now = Date.now()): number {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
  return buckets.size
}

export function clearHits(key: string): void {
  buckets.delete(key)
}
