import { describe, expect, it } from 'vitest'
import { pageErrorIsFatal } from '../shared/utils/page-error'

describe('whether a page\'s error is fatal', () => {
  it('is in the browser, whatever the status: that is what shows the error page there', () => {
    expect(pageErrorIsFatal(404, true)).toBe(true)
    expect(pageErrorIsFatal(403, true)).toBe(true)
    expect(pageErrorIsFatal(500, true)).toBe(true)
  })

  it('is not on the server for a wrong, old or forbidden link, so the server logs nothing', () => {
    expect(pageErrorIsFatal(404, false)).toBe(false)
    expect(pageErrorIsFatal(403, false)).toBe(false)
    expect(pageErrorIsFatal(401, false)).toBe(false)
  })

  it('is on the server when the server itself failed, so that does get logged', () => {
    expect(pageErrorIsFatal(500, false)).toBe(true)
    expect(pageErrorIsFatal(503, false)).toBe(true)
  })
})
