/**
 * The client address from an X-Forwarded-For header: the last entry. A proxy appends the
 * address it saw to whatever the client sent, so the last entry is the only one a client
 * can't make up. This assumes exactly one proxy of ours in front (Caddy, a Cloudflare Tunnel,
 * Tailscale Funnel).
 */
export function lastForwardedFor(header: string | undefined): string | undefined {
  const entries = (header ?? '').split(',').map(entry => entry.trim()).filter(Boolean)
  return entries.at(-1)
}
