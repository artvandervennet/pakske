import { describe, expect, it } from 'vitest'
import { amountChange, cleanText, commitAction, fieldChange, followsSaved, linkChange, linkRemoval, MAX_LINKS, oneLine, savedText, stepAmount, type WishTextField } from '../shared/utils/wish-edit'

const wish = {
  title: 'Slimme stekkers',
  description: 'Twee, voor de lampen\nin de woonkamer',
}
const bare = { title: 'Sokken', description: null }
// The change a field of this wish sends, measured against the wish as the list has it.
const change = (from: typeof wish | typeof bare, field: WishTextField, text: string) => fieldChange(field, text, savedText(from, field))

describe('what a field shows of the saved wish, and what Escape puts back', () => {
  it('is the saved text', () => {
    expect(savedText(wish, 'title')).toBe('Slimme stekkers')
    expect(savedText(wish, 'description')).toBe('Twee, voor de lampen\nin de woonkamer')
  })

  it('is empty for a text the wish has none of', () => {
    expect(savedText(bare, 'description')).toBe('')
  })
})

describe('the change a field sends', () => {
  it('sends only the field that was edited', () => {
    expect(change(wish, 'title', 'Slimme stekkers (3)')).toEqual({ title: 'Slimme stekkers (3)' })
    expect(change(wish, 'description', 'Drie')).toEqual({ description: 'Drie' })
  })

  it('sends nothing when the text says what is saved already', () => {
    expect(change(wish, 'title', 'Slimme stekkers')).toBeNull()
    expect(change(wish, 'title', '  Slimme stekkers ')).toBeNull()
    expect(change(wish, 'description', 'Twee, voor de lampen\nin de woonkamer\n')).toBeNull()
    expect(change(bare, 'description', '')).toBeNull()
  })

  it('clears a text that was emptied', () => {
    expect(change(wish, 'description', '  ')).toEqual({ description: null })
  })

  it('sends an emptied title, so the server can say it is needed', () => {
    expect(change(wish, 'title', ' ')).toEqual({ title: '' })
  })

  it('keeps the lines of a text, but makes a title one line', () => {
    expect(change(bare, 'description', 'Rood\n\nmaat 42')).toEqual({ description: 'Rood\n\nmaat 42' })
    expect(change(bare, 'title', 'Wollen\n sokken')).toEqual({ title: 'Wollen sokken' })
  })
})

describe('a title typed or pasted over several lines', () => {
  it('becomes one line, with a space where a line ended', () => {
    expect(oneLine('Verjaardag\nvan Art')).toBe('Verjaardag van Art')
    expect(oneLine('Verjaardag \r\n  van Art')).toBe('Verjaardag van Art')
    expect(oneLine('Kerst')).toBe('Kerst')
  })
})

describe('the change the amount sends', () => {
  it('sends the new amount, or no limit', () => {
    expect(amountChange(1, 3)).toEqual({ quantity: 3 })
    expect(amountChange(3, null)).toEqual({ quantity: null })
    expect(amountChange(null, 2)).toEqual({ quantity: 2 })
  })

  it('sends nothing when the amount is the saved one', () => {
    expect(amountChange(2, 2)).toBeNull()
    expect(amountChange(null, null)).toBeNull()
  })
})

describe('a step of the amount', () => {
  it('goes up and down by one', () => {
    expect(stepAmount(1, 1)).toBe(2)
    expect(stepAmount(3, -1)).toBe(2)
  })

  it('stays between 1 and 999, what the server accepts', () => {
    expect(stepAmount(1, -1)).toBe(1)
    expect(stepAmount(999, 1)).toBe(999)
  })
})

describe('when a field takes the refreshed list', () => {
  it('only when nobody is editing it', () => {
    expect(followsSaved({ focused: false, saving: false, failed: false })).toBe(true)
  })

  it("not while it has the focus, so a refresh doesn't overwrite what is being typed", () => {
    expect(followsSaved({ focused: true, saving: false, failed: false })).toBe(false)
  })

  it('not while its save is on the way, or after it failed, so the typed text stays', () => {
    expect(followsSaved({ focused: false, saving: true, failed: false })).toBe(false)
    expect(followsSaved({ focused: false, saving: false, failed: true })).toBe(false)
  })
})

describe('the text a save leaves in a field', () => {
  it('is what was sent, as the server keeps it: without spaces around it', () => {
    expect(cleanText('  Rood, maat 42\n', 'text')).toBe('Rood, maat 42')
    expect(cleanText('Rood\n\nmaat 42', 'text')).toBe('Rood\n\nmaat 42')
    expect(cleanText(' https://example.com ', 'url')).toBe('https://example.com')
  })

  it('is one line for a title', () => {
    expect(cleanText(' Wollen\n sokken ', 'line')).toBe('Wollen sokken')
  })
})

describe('what leaving a field, or Enter, does with what it holds', () => {
  const field = (draft: string, atFocus: string, failedText: string | null = null) => ({ draft, atFocus, failedText })

  it('sends a text that was changed since the field got the focus', () => {
    expect(commitAction(field('Rood', ''), 'blur')).toBe('send')
    expect(commitAction(field('Rood', ''), 'enter')).toBe('send')
  })

  it("sends nothing for a text left as it was, and takes the list's value instead", () => {
    // Someone else may have changed it meanwhile; the unchanged, older text must not overwrite that.
    expect(commitAction(field('Rood', 'Rood'), 'blur')).toBe('adopt')
    expect(commitAction(field('Rood', 'Rood'), 'enter')).toBe('adopt')
  })

  it('keeps a failed text when the field is left unchanged, and tries again on Enter', () => {
    expect(commitAction(field('Rood', '', 'Rood'), 'blur')).toBe('keep')
    expect(commitAction(field('Rood', 'Rood', 'Rood'), 'blur')).toBe('keep')
    expect(commitAction(field('Rood', 'Rood', 'Rood'), 'enter')).toBe('send')
  })

  it('sends a failed text that was changed since it failed', () => {
    expect(commitAction(field('Rood!', 'Rood', 'Rood'), 'blur')).toBe('send')
  })
})

describe("the change a field sends, measured against the field's own saved text", () => {
  // After a save whose refresh failed, the field knows what was saved and the list doesn't yet.
  it('sends the text when it differs from what the field last saved', () => {
    expect(fieldChange('description', 'Oud', 'Nieuw')).toEqual({ description: 'Oud' })
    expect(fieldChange('title', 'Sokken', 'Wollen sokken')).toEqual({ title: 'Sokken' })
  })

  it('sends nothing when it is what the field last saved', () => {
    expect(fieldChange('description', ' Nieuw ', 'Nieuw')).toBeNull()
    expect(fieldChange('description', '', '')).toBeNull()
  })

  it('clears an emptied text', () => {
    expect(fieldChange('description', ' ', 'Nieuw')).toEqual({ description: null })
  })
})

describe('the change the field of one link sends', () => {
  const shop = 'https://example.com/stekker'
  const other = 'https://example.org/stekker'

  it('is the whole list, with that link changed and the others where they were', () => {
    expect(linkChange([shop, other], 0, 'https://example.net/x')).toEqual({ urls: ['https://example.net/x', other] })
    expect(linkChange([shop, other], 1, ' https://example.net/x ')).toEqual({ urls: [shop, 'https://example.net/x'] })
  })

  it('puts a new link at the end', () => {
    expect(linkChange([], 0, shop)).toEqual({ urls: [shop] })
    expect(linkChange([shop], 1, other)).toEqual({ urls: [shop, other] })
  })

  it('sends nothing when the field says what is saved already', () => {
    expect(linkChange([shop, other], 1, ` ${other} `)).toBeNull()
    expect(linkChange([shop], 1, '  ')).toBeNull()
    expect(linkChange([], 0, '')).toBeNull()
  })

  it('takes an emptied link off the list', () => {
    expect(linkChange([shop, other], 0, ' ')).toEqual({ urls: [other] })
    expect(linkChange([shop], 0, '')).toEqual({ urls: [] })
  })

  it('takes one link off with its button, and keeps the order of the rest', () => {
    expect(linkRemoval([shop, other, 'https://example.net/x'], 1)).toEqual({ urls: [shop, 'https://example.net/x'] })
    expect(linkRemoval([shop], 0)).toEqual({ urls: [] })
  })

  it('never changes the list it was given', () => {
    const saved = [shop, other]
    linkChange(saved, 0, '')
    linkRemoval(saved, 0)
    expect(saved).toEqual([shop, other])
  })

  it('allows as many links as the server does', () => {
    expect(MAX_LINKS).toBe(5)
  })
})
