import { describe, expect, it } from 'vitest'
import { acceptInput, fieldErrors, inviteInput, listInput, registerInput, targetInput, wishInput, wishPatchInput } from '../shared/schemas/input'

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

describe('a change to a wish someone submits', () => {
  it('holds only the fields that were sent, with nothing filled in', () => {
    expect(wishPatchInput.parse({ title: ' Dik boek ' })).toEqual({ title: 'Dik boek' })
    expect(wishPatchInput.parse({ quantity: null })).toEqual({ quantity: null })
  })

  it('still turns empty text into null', () => {
    expect(wishPatchInput.parse({ description: '', url: '' })).toEqual({ description: null, url: null })
  })

  it('checks the fields that were sent like a new wish', () => {
    expect(fieldErrors(wishPatchInput.safeParse({ title: '  ' }).error!)).toEqual({ title: 'required' })
    expect(fieldErrors(wishPatchInput.safeParse({ url: 'javascript:alert(1)' }).error!)).toEqual({ url: 'invalid_url' })
    expect(fieldErrors(wishPatchInput.safeParse({ quantity: 0 }).error!)).toEqual({ quantity: 'invalid_amount' })
  })

  it('needs at least one field', () => {
    expect(wishPatchInput.safeParse({}).success).toBe(false)
  })
})

describe('a list someone submits', () => {
  it('names a list', () => {
    expect(fieldErrors(listInput.safeParse({ title: '   ' }).error!)).toEqual({ title: 'required' })
  })
})

describe('the list a wish should land on', () => {
  it('is one of the person\'s lists, or a new one with a name', () => {
    expect(targetInput.parse({ list: 'abc' })).toEqual({ list: 'abc' })
    expect(targetInput.parse({ newList: '  Samen ' })).toEqual({ newList: 'Samen' })
  })

  it('is not both, and not nothing', () => {
    expect(targetInput.safeParse({ list: 'abc', newList: 'Samen' }).success).toBe(false)
    expect(targetInput.safeParse({}).success).toBe(false)
  })

  it('needs a name for a new list and a list for an existing one', () => {
    expect(fieldErrors(targetInput.safeParse({ newList: '   ' }).error!)).toEqual({ newList: 'required' })
    expect(fieldErrors(targetInput.safeParse({ list: '' }).error!)).toEqual({ list: 'required' })
    expect(fieldErrors(targetInput.safeParse({ list: 'x'.repeat(65) }).error!)).toEqual({ list: 'too_long' })
    expect(fieldErrors(targetInput.safeParse({ newList: 'x'.repeat(81) }).error!)).toEqual({ newList: 'too_long' })
  })
})

describe('a link that works once', () => {
  it('is for 1 to 50 wishes, or for the list', () => {
    expect(inviteInput.parse({ kind: 'wishes', wishIds: [3, 7] })).toEqual({ kind: 'wishes', wishIds: [3, 7] })
    expect(inviteInput.parse({ kind: 'list' })).toEqual({ kind: 'list' })
    expect(inviteInput.safeParse({ kind: 'wishes', wishIds: Array.from({ length: 50 }, (_, i) => i + 1) }).success).toBe(true)
    expect(fieldErrors(inviteInput.safeParse({ kind: 'wishes', wishIds: [] }).error!)).toEqual({ wishIds: 'required' })
    expect(fieldErrors(inviteInput.safeParse({ kind: 'wishes', wishIds: Array.from({ length: 51 }, (_, i) => i + 1) }).error!)).toEqual({ wishIds: 'too_long' })
    for (const bad of [0, -1, 1.5, '3']) {
      expect(inviteInput.safeParse({ kind: 'wishes', wishIds: [bad] }).success).toBe(false)
    }
    expect(inviteInput.safeParse({ kind: 'list', wishIds: [1] }).success).toBe(false)
    expect(inviteInput.safeParse({ kind: 'other' }).success).toBe(false)
  })

  it('is accepted onto a list of the person\'s, or with nothing for a list link', () => {
    expect(acceptInput.parse({})).toBeNull()
    expect(acceptInput.parse({ list: 'abc' })).toEqual({ list: 'abc' })
    expect(acceptInput.parse({ newList: '  Samen ' })).toEqual({ newList: 'Samen' })
    expect(acceptInput.safeParse({ other: 1 }).success).toBe(false)
    expect(acceptInput.safeParse({ list: 'abc', newList: 'Samen' }).success).toBe(false)
    expect(fieldErrors(acceptInput.safeParse({ newList: '   ' }).error!)).toEqual({ newList: 'required' })
    expect(fieldErrors(acceptInput.safeParse({ list: '' }).error!)).toEqual({ list: 'required' })
  })
})

describe('a registration someone submits', () => {
  const valid = { email: ' Art@Example.Test ', displayName: ' Art ', password: 'correct horse' }

  it('lowercases the email and trims the name', () => {
    expect(registerInput.parse(valid)).toMatchObject({ email: 'art@example.test', displayName: 'Art' })
  })

  it('carries the language of the page, Dutch when it says nothing', () => {
    expect(registerInput.parse(valid).locale).toBe('nl')
    expect(registerInput.parse({ ...valid, locale: 'en' }).locale).toBe('en')
    expect(registerInput.safeParse({ ...valid, locale: 'fr' }).success).toBe(false)
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
