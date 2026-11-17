import { describe, expect, it } from 'vitest'
import { lastForwardedFor } from '../server/utils/client-ip'
import { safeNextPath } from '../shared/utils/safe-next'

const ORIGIN = 'https://wishlist.example'

describe('where the login page sends someone afterwards', () => {
  it('keeps a path on this site, with its query', () => {
    expect(safeNextPath('/l/AbCdEfGhIjKlMnOpQrStUv?x=1', ORIGIN)).toBe('/l/AbCdEfGhIjKlMnOpQrStUv?x=1')
  })

  it.each([
    ['another site', 'https://evil.example/'],
    ['a protocol-relative address', '//evil.example'],
    ['a backslash the browser reads as a slash', '/\\evil.example'],
    ['a tab the browser drops', '/\t/evil.example'],
    ['a script', 'javascript:alert(1)'],
    ['something that is not text', ['/l/AbCdEfGhIjKlMnOpQrStUv']],
    ['nothing', undefined],
  ])('refuses %s', (_name, value) => {
    expect(safeNextPath(value, ORIGIN)).toBeNull()
  })
})

describe('the address a proxied request came from', () => {
  it('is the last entry: the one our own proxy added', () => {
    expect(lastForwardedFor('203.0.113.7')).toBe('203.0.113.7')
    expect(lastForwardedFor('1.2.3.4, 203.0.113.7')).toBe('203.0.113.7')
  })

  it('ignores what the client put in front, so a made-up address changes nothing', () => {
    expect(lastForwardedFor('9.9.9.9,8.8.8.8 ,  203.0.113.7 ')).toBe('203.0.113.7')
  })

  it('is undefined when the header is missing or empty', () => {
    expect(lastForwardedFor(undefined)).toBeUndefined()
    expect(lastForwardedFor(' , ')).toBeUndefined()
  })
})
