export type Viewer = 'anon' | 'owner' | 'buyer'

/** Who is looking at a list. Decided on the server, from the session, never from the request. */
export function resolveViewer(sessionUserId: number | null | undefined, listOwnerId: number): Viewer {
  if (sessionUserId == null) return 'anon'
  return sessionUserId === listOwnerId ? 'owner' : 'buyer'
}
