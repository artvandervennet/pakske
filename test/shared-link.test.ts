import { describe, expect, it } from 'vitest'
import { namesAll, sharedLinkKind } from '../shared/utils/shared-link'

describe('what kind of link a path is', () => {
  it('knows the three links that need a login', () => {
    expect(sharedLinkKind('/s/abc123')).toBe('santa')
    expect(sharedLinkKind('/j/abc123')).toBe('invite')
    expect(sharedLinkKind('/f/abc123')).toBe('friend')
  })

  it('reads past the language and stops at what follows the token', () => {
    expect(sharedLinkKind('/en/s/abc123')).toBe('santa')
    expect(sharedLinkKind('/j/abc123?x=1')).toBe('invite')
    expect(sharedLinkKind('/en/f/abc123#top')).toBe('friend')
  })

  it('answers null for every other page', () => {
    for (const path of ['/', '/l/abc123', '/santa', '/settings', '/s/', '/s', '/english/s/abc', '/x/s/abc/def/s/abc', '', null, undefined]) {
      expect(sharedLinkKind(path), String(path)).toBeNull()
    }
  })
})

describe('whether a list is named after its owners', () => {
  it('finds every owner in the name, in any case', () => {
    expect(namesAll('Verjaardag Art', ['Art'])).toBe(true)
    expect(namesAll('Kerst bij art en LOTTE', ['Art', 'Lotte'])).toBe(true)
  })

  it('says no when one of them is missing, or there are none', () => {
    expect(namesAll('Kerst 2026', ['Art'])).toBe(false)
    expect(namesAll('Verjaardag Art', ['Art', 'Lotte'])).toBe(false)
    expect(namesAll('Verjaardag Art', [])).toBe(false)
  })
})
