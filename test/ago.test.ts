import { describe, expect, it } from 'vitest'
import { ago } from '../shared/utils/ago'

const now = new Date('2026-11-19T12:00:00Z')
const before = (ms: number) => new Date(now.getTime() - ms)
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('how long ago', () => {
  it('says "now" for the first minute, also for a clock that runs a little ahead', () => {
    expect(ago(before(0), now, 'nl')).toBe('nu')
    expect(ago(before(59 * 1000), now, 'nl')).toBe('nu')
    expect(ago(before(-5000), now, 'nl')).toBe('nu')
    expect(ago(before(20 * 1000), now, 'en')).toBe('now')
  })

  it('counts whole minutes, hours and days that have passed', () => {
    expect(ago(before(12 * MIN + 40 * 1000), now, 'nl')).toBe('12 minuten geleden')
    expect(ago(before(59 * MIN + 59 * 1000), now, 'nl')).toBe('59 minuten geleden')
    expect(ago(before(2 * HOUR + 50 * MIN), now, 'nl')).toBe('2 uur geleden')
    expect(ago(before(3 * DAY + 5 * HOUR), now, 'nl')).toBe('3 dagen geleden')
    expect(ago(before(2 * HOUR), now, 'en')).toBe('2 hours ago')
  })

  it('says yesterday, and the date once a week has passed', () => {
    expect(ago(before(DAY + HOUR), now, 'nl')).toBe('gisteren')
    expect(ago(before(DAY + HOUR), now, 'en')).toBe('yesterday')
    expect(ago(before(6 * DAY + 23 * HOUR), now, 'nl')).toBe('6 dagen geleden')
    expect(ago(before(7 * DAY), now, 'nl')).toBe('12 november')
    expect(ago(before(30 * DAY), now, 'en')).toBe('October 20')
  })
})
