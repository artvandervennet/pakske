import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/en.json'
import nl from '../i18n/locales/nl.json'
import { KEPT_FOR_BUYERS_DAYS, keptForBuyers, leftListAt } from '../shared/utils/kept-for-buyers'

const day = 24 * 60 * 60 * 1000
const at = (ms: number) => new Date(Date.UTC(2026, 11, 1) + ms)

describe('when a wish left its list', () => {
  it('is never for a wish that is still on it', () => {
    expect(leftListAt(null, null, null)).toBeNull()
  })

  it('is the first of: taken off the list, the wish deleted, the list deleted', () => {
    expect(leftListAt(at(5), null, null)).toEqual(at(5))
    expect(leftListAt(at(5), at(6), at(9))).toEqual(at(5))
    expect(leftListAt(null, at(6), at(2))).toEqual(at(2))
  })
})

describe('how long a wish that left its list stays for whoever bought it', () => {
  it('is thirty days', () => {
    expect(KEPT_FOR_BUYERS_DAYS).toBe(30)
  })

  it('is the number the privacy page gives, which has no way to fill it in', () => {
    expect(nl.privacy.keep.deleted).toContain(`nog ${KEPT_FOR_BUYERS_DAYS} dagen`)
    expect(en.privacy.keep.deleted).toContain(`for ${KEPT_FOR_BUYERS_DAYS} days`)
  })

  it('lasts until those days are over, to the millisecond', () => {
    const left = at(0)
    expect(keptForBuyers(left, at(0))).toBe(true)
    expect(keptForBuyers(left, at(30 * day - 1))).toBe(true)
    expect(keptForBuyers(left, at(30 * day))).toBe(false)
    expect(keptForBuyers(left, at(400 * day))).toBe(false)
  })
})
