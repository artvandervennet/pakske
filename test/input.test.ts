import { describe, expect, it } from 'vitest'
import { acceptInput, accountDeleteInput, emailChangeInput, fieldErrors, inviteInput, listInput, profileInput, registerInput, targetInput, wishInput, wishPatchInput } from '../shared/schemas/input'

const wish = (over: Record<string, unknown> = {}) => wishInput.safeParse({ title: 'Boek', description: '', urls: [], quantity: 1, ...over })

describe('a wish someone submits', () => {
  it('turns empty optional text into null and trims the title', () => {
    expect(wish({ title: '  Boek  ' }).data).toEqual({ title: 'Boek', description: null, urls: [], quantity: 1 })
  })

  it('needs only a title, and fills in the rest', () => {
    expect(wishInput.parse({ title: '  Boek ' })).toEqual({ title: 'Boek', description: null, urls: [], quantity: 1 })
  })

  it('keeps null as "no limit"', () => {
    expect(wishInput.parse({ title: 'Puzzels', quantity: null }).quantity).toBeNull()
  })

  it('needs a title', () => {
    expect(fieldErrors(wish({ title: '   ' }).error!)).toEqual({ title: 'required' })
  })

  it('takes a title of at most 200 characters, and names a longer one by a code of its own', () => {
    expect(wish({ title: 'x'.repeat(200) }).success).toBe(true)
    expect(wish({ title: ` ${'x'.repeat(200)} ` }).success).toBe(true)
    expect(fieldErrors(wish({ title: 'x'.repeat(201) }).error!)).toEqual({ title: 'title_too_long' })
    expect(fieldErrors(wishPatchInput.safeParse({ title: 'x'.repeat(201) }).error!)).toEqual({ title: 'title_too_long' })
  })

  it('accepts http and https links only', () => {
    expect(wish({ urls: ['https://example.test/x', 'http://example.test/y'] }).success).toBe(true)
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'example.test', '', '   ']) {
      expect(fieldErrors(wish({ urls: ['https://example.test/x', bad] }).error!), bad).toEqual({ urls: 'invalid_url' })
    }
  })

  it('keeps the links in their order, without the spaces around them', () => {
    expect(wish({ urls: [' https://b.example.test/ ', 'https://a.example.test/'] }).data!.urls)
      .toEqual(['https://b.example.test/', 'https://a.example.test/'])
  })

  it('takes at most five links, each at most 2000 characters, each once', () => {
    const link = (n: number) => `https://example.test/${n}`
    expect(wish({ urls: [1, 2, 3, 4, 5].map(link) }).success).toBe(true)
    expect(fieldErrors(wish({ urls: [1, 2, 3, 4, 5, 6].map(link) }).error!)).toEqual({ urls: 'too_many_links' })
    const longest = `https://example.test/${'x'.repeat(2000 - 'https://example.test/'.length)}`
    expect(wish({ urls: [longest] }).success).toBe(true)
    expect(fieldErrors(wish({ urls: [`${longest}x`] }).error!)).toEqual({ urls: 'too_long' })
    expect(fieldErrors(wish({ urls: [link(1), link(2), ` ${link(1)} `] }).error!)).toEqual({ urls: 'duplicate_link' })
  })

  it('refuses links that are not a list of texts', () => {
    expect(wish({ urls: 'https://example.test/x' }).success).toBe(false)
    expect(wish({ urls: [7] }).success).toBe(false)
    expect(wish({ urls: null }).success).toBe(false)
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
    expect(wishPatchInput.parse({ description: '' })).toEqual({ description: null })
  })

  it('replaces the links with the list that was sent, and clears them with an empty one', () => {
    expect(wishPatchInput.parse({ urls: ['https://example.test/x'] })).toEqual({ urls: ['https://example.test/x'] })
    expect(wishPatchInput.parse({ urls: [] })).toEqual({ urls: [] })
  })

  it('checks the fields that were sent like a new wish', () => {
    expect(fieldErrors(wishPatchInput.safeParse({ title: '  ' }).error!)).toEqual({ title: 'required' })
    expect(fieldErrors(wishPatchInput.safeParse({ urls: ['javascript:alert(1)'] }).error!)).toEqual({ urls: 'invalid_url' })
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

describe('a link that shares wishes or a list', () => {
  it('is for 1 to 50 wishes, as copies unless it says together, or for the list', () => {
    expect(inviteInput.parse({ kind: 'wishes', wishIds: [3, 7] })).toEqual({ kind: 'wishes', mode: 'copy', wishIds: [3, 7] })
    expect(inviteInput.parse({ kind: 'wishes', mode: 'linked', wishIds: [3] })).toEqual({ kind: 'wishes', mode: 'linked', wishIds: [3] })
    expect(inviteInput.parse({ kind: 'wishes', mode: 'copy', wishIds: [3] })).toEqual({ kind: 'wishes', mode: 'copy', wishIds: [3] })
    expect(fieldErrors(inviteInput.safeParse({ kind: 'wishes', mode: 'both', wishIds: [3] }).error!)).toEqual({ mode: 'invalid' })
    expect(inviteInput.parse({ kind: 'list' })).toEqual({ kind: 'list' })
    expect(inviteInput.safeParse({ kind: 'wishes', wishIds: Array.from({ length: 50 }, (_, i) => i + 1) }).success).toBe(true)
    expect(fieldErrors(inviteInput.safeParse({ kind: 'wishes', wishIds: [] }).error!)).toEqual({ wishIds: 'required' })
    expect(fieldErrors(inviteInput.safeParse({ kind: 'wishes', wishIds: Array.from({ length: 51 }, (_, i) => i + 1) }).error!)).toEqual({ wishIds: 'too_long' })
    for (const bad of [0, -1, 1.5, '3']) {
      expect(inviteInput.safeParse({ kind: 'wishes', wishIds: [bad] }).success).toBe(false)
    }
    expect(inviteInput.safeParse({ kind: 'list', wishIds: [1] }).success).toBe(false)
    // A list is only ever shared together.
    expect(inviteInput.safeParse({ kind: 'list', mode: 'copy' }).success).toBe(false)
    expect(inviteInput.safeParse({ kind: 'other' }).success).toBe(false)
  })

  it('is accepted onto a list of the person\'s, or with nothing for a list link', () => {
    expect(acceptInput.parse({})).toEqual({ target: null })
    expect(acceptInput.parse({ list: 'abc' })).toEqual({ target: { list: 'abc' } })
    expect(acceptInput.parse({ newList: '  Samen ' })).toEqual({ target: { newList: 'Samen' } })
    expect(acceptInput.safeParse({ other: 1 }).success).toBe(false)
    expect(acceptInput.safeParse({ list: 'abc', newList: 'Samen' }).success).toBe(false)
    expect(fieldErrors(acceptInput.safeParse({ newList: '   ' }).error!)).toEqual({ newList: 'required' })
    expect(fieldErrors(acceptInput.safeParse({ list: '' }).error!)).toEqual({ list: 'required' })
  })

  it('can name which of the wishes to take: at least one, each once, 50 at most', () => {
    expect(acceptInput.parse({ list: 'abc', wishIds: [7, 3] })).toEqual({ target: { list: 'abc' }, wishIds: [7, 3] })
    expect(acceptInput.parse({ newList: 'Samen', wishIds: [3] })).toEqual({ target: { newList: 'Samen' }, wishIds: [3] })
    expect(acceptInput.safeParse({ list: 'abc', wishIds: Array.from({ length: 50 }, (_, i) => i + 1) }).success).toBe(true)
    expect(fieldErrors(acceptInput.safeParse({ list: 'abc', wishIds: [] }).error!)).toEqual({ wishIds: 'required' })
    expect(fieldErrors(acceptInput.safeParse({ list: 'abc', wishIds: Array.from({ length: 51 }, (_, i) => i + 1) }).error!)).toEqual({ wishIds: 'too_long' })
    expect(fieldErrors(acceptInput.safeParse({ newList: 'Samen', wishIds: [3, 3] }).error!)).toEqual({ wishIds: 'invalid' })
    for (const bad of [0, -1, 1.5, '3']) {
      expect(acceptInput.safeParse({ list: 'abc', wishIds: [bad] }).success).toBe(false)
    }
    // A link to a list takes the whole list: there is nothing to choose.
    expect(acceptInput.safeParse({ wishIds: [3] }).success).toBe(false)
  })
})

describe('a registration someone submits', () => {
  const valid = { email: ' Art@Example.Test ', displayName: ' Art ', password: 'correct horse' }

  it('lowercases the email and trims the name', () => {
    expect(registerInput.parse(valid)).toMatchObject({ email: 'art@example.test', displayName: 'Art' })
  })

  it('takes a password from 8 characters', () => {
    expect(registerInput.safeParse({ ...valid, password: '12345678' }).success).toBe(true)
    expect(fieldErrors(registerInput.safeParse({ ...valid, password: '1234567' }).error!)).toEqual({ password: 'password_short' })
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

describe('a change to the profile someone submits', () => {
  it('holds only what was sent', () => {
    expect(profileInput.parse({ displayName: ' Art ' })).toEqual({ displayName: 'Art' })
    expect(profileInput.parse({ anonymousDefault: true })).toEqual({ anonymousDefault: true })
    expect(profileInput.parse({ displayName: 'Art', anonymousDefault: false })).toEqual({ displayName: 'Art', anonymousDefault: false })
  })

  it('needs something, a name that is one, and a yes or no', () => {
    expect(profileInput.safeParse({}).success).toBe(false)
    expect(fieldErrors(profileInput.safeParse({ displayName: '  ' }).error!)).toEqual({ displayName: 'required' })
    expect(fieldErrors(profileInput.safeParse({ anonymousDefault: 'yes' }).error!)).toEqual({ anonymousDefault: 'invalid' })
  })
})

describe('what Settings asks before a change to the account itself', () => {
  it('takes a new address, with the current password when there is one', () => {
    expect(emailChangeInput.parse({ email: ' Art@New.Test ' })).toEqual({ email: 'art@new.test', locale: 'nl' })
    expect(emailChangeInput.parse({ email: 'art@new.test', currentPassword: 'correct horse', locale: 'en' })).toEqual({ email: 'art@new.test', currentPassword: 'correct horse', locale: 'en' })
    expect(fieldErrors(emailChangeInput.safeParse({ email: 'nope', currentPassword: '' }).error!)).toEqual({ email: 'invalid_email', currentPassword: 'required' })
  })

  it('deletes the account on the current password, or on nothing for an account without one', () => {
    expect(accountDeleteInput.parse({})).toEqual({})
    expect(accountDeleteInput.parse({ currentPassword: 'correct horse' })).toEqual({ currentPassword: 'correct horse' })
    expect(fieldErrors(accountDeleteInput.safeParse({ currentPassword: '' }).error!)).toEqual({ currentPassword: 'required' })
  })
})
