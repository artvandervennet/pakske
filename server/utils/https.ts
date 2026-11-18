const HOST = /^[a-z0-9.-]+(:\d+)?$/i

/**
 * How the visitor reached the proxy in front, from its X-Forwarded-Proto. Like
 * X-Forwarded-For, the last entry is the one a visitor can't make up. Undefined for a request
 * no proxy spoke for: the port reached directly, a health check.
 */
export function forwardedScheme(header: string | undefined): 'http' | 'https' | undefined {
  const scheme = (header ?? '').split(',').at(-1)!.trim().toLowerCase()
  return scheme === 'http' || scheme === 'https' ? scheme : undefined
}

/**
 * Where a visitor who came over plain http should go instead: the same page over https, or
 * undefined when they are where they should be.
 */
export function httpsAddress(forwardedProto: string | undefined, host: string | undefined, path: string): string | undefined {
  if (forwardedScheme(forwardedProto) !== 'http' || !host || !HOST.test(host) || !path.startsWith('/')) return undefined
  return `https://${host.replace(/:80$/, '')}${path}`
}
