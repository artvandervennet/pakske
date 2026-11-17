/**
 * The path to go to after logging in, taken from `?next=`, or null when it isn't a path on
 * this site. The value is resolved the way a browser would resolve it and must land on our
 * own origin: `//evil.example`, `/\evil.example` and `/<tab>/evil.example` all look like
 * paths and all lead somewhere else.
 */
export function safeNextPath(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null
  // A browser would quietly repair these. Nothing this site links to contains them.
  if (/[\\\t\n\r]/.test(value)) return null
  try {
    const url = new URL(value, origin)
    return url.origin === new URL(origin).origin ? url.pathname + url.search + url.hash : null
  }
  catch {
    return null
  }
}
