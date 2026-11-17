import { describe, expect, it } from 'vitest'
import { fieldErrors, listInput, registerInput, wishInput } from '../shared/schemas/input'

const wish = (over: Record<string, unknown> = {}) => wishInput.safeParse({ title: 'Boek', description: '', url: '', quantity: 1, ...over })

describe('a wish someone submits', () => {
  it('turns empty optional text into null and trims the title', () => {
    expect(wish({ title: '  Boek  ' }).data).toEqual({ title: 'Boek', description: null, url: null, quantity: 1 })
  })

  it('needs only a title, and fills in the rest', () => {
    expect(wishInput.parse({ title: '  Boek ' })).toEqual({ title: 'Boek', description: null, url: null, quantity: 1 })
  })

  it('keeps null as "no limit"', () => {
    expect(wishInput.parse({ title: 'Puzzels', quantity: null }).quantity).toBeNull()
  })

  it('needs a title', () => {
    expect(fieldErrors(wish({ title: '   ' }).error!)).toEqual({ title: 'required' })
  })

  it('accepts http and https links only', () => {
    expect(wish({ url: 'https://example.test/x' }).success).toBe(true)
    expect(fieldErrors(wish({ url: 'javascript:alert(1)' }).error!)).toEqual({ url: 'invalid_url' })
    expect(fieldErrors(wish({ url: 'example.test' }).error!)).toEqual({ url: 'invalid_url' })
  })

  it('refuses zero and fractions as an amount', () => {
    expect(fieldErrors(wish({ quantity: 0 }).error!)).toEqual({ quantity: 'invalid_amount' })
    expect(fieldErrors(wish({ quantity: 1.5 }).error!)).toEqual({ quantity: 'invalid_amount' })
  })
})

describe('a list someone submits', () => {
  it('names a list', () => {
    expect(fieldErrors(listInput.safeParse({ title: '   ' }).error!)).toEqual({ title: 'required' })
  })
})

describe('a registration someone submits', () => {
  const valid = { email: ' Art@Example.Test ', displayName: ' Art ', password: 'correct horse' }

  it('lowercases the email and trims the name', () => {
    expect(registerInput.parse(valid)).toMatchObject({ email: 'art@example.test', displayName: 'Art' })
  })

  it('names each field that is wrong', () => {
    const result = registerInput.safeParse({ email: 'nope', displayName: '', password: 'short' })
    expect(fieldErrors(result.error!)).toEqual({
      email: 'invalid_email',
      displayName: 'required',
      password: 'password_short',
    })
  })
})
