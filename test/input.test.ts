import { describe, expect, it } from 'vitest'
import { fieldErrors, itemInput, registerInput } from '../shared/schemas/input'

const item = (over: Record<string, unknown> = {}) => itemInput.safeParse({ title: 'Boek', description: '', url: '', quantity: 1, ...over })

describe('a wish someone submits', () => {
  it('turns empty optional text into null and trims the title', () => {
    expect(item({ title: '  Boek  ' }).data).toEqual({ title: 'Boek', description: null, url: null, quantity: 1 })
  })

  it('needs a title', () => {
    expect(fieldErrors(item({ title: '   ' }).error!)).toEqual({ title: 'required' })
  })

  it('accepts http and https links only', () => {
    expect(item({ url: 'https://example.test/x' }).success).toBe(true)
    expect(fieldErrors(item({ url: 'javascript:alert(1)' }).error!)).toEqual({ url: 'invalid_url' })
    expect(fieldErrors(item({ url: 'example.test' }).error!)).toEqual({ url: 'invalid_url' })
  })

  it('takes null as "no limit" and refuses zero and fractions', () => {
    expect(item({ quantity: null }).data?.quantity).toBeNull()
    expect(fieldErrors(item({ quantity: 0 }).error!)).toEqual({ quantity: 'invalid_amount' })
    expect(fieldErrors(item({ quantity: 1.5 }).error!)).toEqual({ quantity: 'invalid_amount' })
  })
})

describe('a registration someone submits', () => {
  const valid = { email: ' Art@Example.Test ', username: 'art', displayName: ' Art ', password: 'correct horse' }

  it('lowercases the email and trims the name', () => {
    expect(registerInput.parse(valid)).toMatchObject({ email: 'art@example.test', displayName: 'Art' })
  })

  it('names each field that is wrong', () => {
    const result = registerInput.safeParse({ email: 'nope', username: 'Art!', displayName: '', password: 'short' })
    expect(fieldErrors(result.error!)).toEqual({
      email: 'invalid_email',
      username: 'invalid_username',
      displayName: 'required',
      password: 'password_short',
    })
  })
})
