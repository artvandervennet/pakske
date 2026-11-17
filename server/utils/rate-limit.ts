// A small in-memory limiter. One server process, a handful of people: no store needed.
// Counters reset when the server restarts.

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
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
  }
}

export function clearHits(key: string): void {
  buckets.delete(key)
}
