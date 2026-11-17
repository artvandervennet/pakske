import { describe, expect, it } from 'vitest'
import { amountChange, followsSaved, oneLine, savedText, stepAmount, textChange } from '../shared/utils/wish-edit'

const wish = {
  title: 'Slimme stekkers',
  description: 'Twee, voor de lampen\nin de woonkamer',
  url: 'https://example.com/stekker',
}
const bare = { title: 'Sokken', description: null, url: null }

describe('what a field shows of the saved wish, and what Escape puts back', () => {
  it('is the saved text', () => {
    expect(savedText(wish, 'title')).toBe('Slimme stekkers')
    expect(savedText(wish, 'description')).toBe('Twee, voor de lampen\nin de woonkamer')
    expect(savedText(wish, 'url')).toBe('https://example.com/stekker')
  })

  it('is empty for a text or link the wish has none of', () => {
    expect(savedText(bare, 'description')).toBe('')
    expect(savedText(bare, 'url')).toBe('')
  })
})

describe('the change a field sends', () => {
  it('sends only the field that was edited', () => {
    expect(textChange(wish, 'title', 'Slimme stekkers (3)')).toEqual({ title: 'Slimme stekkers (3)' })
    expect(textChange(wish, 'description', 'Drie')).toEqual({ description: 'Drie' })
    expect(textChange(wish, 'url', 'https://example.com/ander')).toEqual({ url: 'https://example.com/ander' })
  })

  it('sends nothing when the text says what is saved already', () => {
    expect(textChange(wish, 'title', 'Slimme stekkers')).toBeNull()
    expect(textChange(wish, 'title', '  Slimme stekkers ')).toBeNull()
    expect(textChange(wish, 'description', 'Twee, voor de lampen\nin de woonkamer\n')).toBeNull()
    expect(textChange(bare, 'description', '')).toBeNull()
    expect(textChange(bare, 'url', '   ')).toBeNull()
  })

  it('clears a text or a link that was emptied', () => {
    expect(textChange(wish, 'description', '  ')).toEqual({ description: null })
    expect(textChange(wish, 'url', '')).toEqual({ url: null })
  })

  it('sends an emptied title, so the server can say it is needed', () => {
    expect(textChange(wish, 'title', ' ')).toEqual({ title: '' })
  })

  it('keeps the lines of a text, but makes a title one line', () => {
    expect(textChange(bare, 'description', 'Rood\n\nmaat 42')).toEqual({ description: 'Rood\n\nmaat 42' })
    expect(textChange(bare, 'title', 'Wollen\n sokken')).toEqual({ title: 'Wollen sokken' })
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
