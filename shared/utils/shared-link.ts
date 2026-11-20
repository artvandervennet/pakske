/** The links that are passed on in a chat and need a login to open: what each one is for. */
export type SharedLinkKind = 'santa' | 'invite' | 'friend'

const KINDS: Record<string, SharedLinkKind> = { s: 'santa', j: 'invite', f: 'friend' }

/**
 * What kind of link a path on this site is, from its first part alone: `/s/…` a Secret Santa
 * group, `/j/…` wishes or a list someone shares, `/f/…` a friend link. Null for every other
 * page. The language may come first (`/en/s/…`). Nothing is looked up, so the answer says
 * nothing about whether the link exists or whose it is.
 */
export function sharedLinkKind(path: string | null | undefined): SharedLinkKind | null {
  const letter = /^(?:\/[a-z]{2})?\/([sjf])\/[^/?#]+/.exec(path ?? '')?.[1]
  return letter ? KINDS[letter]! : null
}

/**
 * Whether a list's name already says whose it is: "Verjaardag Art" for a list of Art's. The
 * preview of its link then doesn't add "van Art" after it.
 */
export function namesAll(title: string, names: string[]): boolean {
  const lower = title.toLocaleLowerCase()
  return names.length > 0 && names.every(name => lower.includes(name.toLocaleLowerCase()))
}
