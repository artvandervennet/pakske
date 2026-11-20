import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { privacyOutline, termsOutline, type LegalSection, type Operator } from '../shared/utils/legal'

// The privacy and terms pages are built from an outline that names their sentences. Nothing else
// reads those sentences, so this checks that each one exists, that none is left over, and that a
// sentence which names the operator is only used when the site knows who that is.

type Messages = { [key: string]: string | Messages }
const load = (lang: string): Messages => JSON.parse(readFileSync(`i18n/locales/${lang}.json`, 'utf8'))

function flatten(messages: Messages, prefix = ''): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' ? [[prefix + key, value] as [string, string]] : flatten(value, `${prefix}${key}.`))
}

const languages = { nl: new Map(flatten(load('nl'))), en: new Map(flatten(load('en'))) }

const nobody: Operator = { name: '', email: '', network: '', backups: '' }
const art: Operator = { name: 'Art', email: 'art@example.test', network: 'Cloudflare', backups: 'Cloudflare' }
/** Every way the four settings can be filled in or left empty. */
const operators: Operator[] = Array.from({ length: 16 }, (_, bits) => ({
  name: bits & 1 ? art.name : '',
  email: bits & 2 ? art.email : '',
  network: bits & 4 ? art.network : '',
  backups: bits & 8 ? art.backups : '',
}))

/** The keys of the sentences an outline shows: its headings, paragraphs, list items and link texts. */
function sentences(sections: LegalSection[]): string[] {
  return sections.flatMap(section => [
    section.title,
    ...section.blocks.flatMap((block) => {
      if (block.kind === 'text' || block.kind === 'link') return [block.key]
      if (block.kind === 'list') return block.keys
      return []
    }),
  ])
}

/** What the page puts in a sentence's `{…}`: only the settings that are filled in. */
const given = (operator: Operator) => [
  ...(operator.name ? ['operator'] : []),
  ...(operator.network ? ['network'] : []),
  ...(operator.backups ? ['backups'] : []),
]

const pages = { privacy: privacyOutline, terms: termsOutline }
/** The sentences the page itself shows around the outline. */
const HEAD = ['title', 'lead', 'updated']

describe.each(Object.entries(pages))('the outline of the %s page', (page, outline) => {
  it.each(operators)('names only sentences that exist in both languages (%o)', (operator) => {
    for (const key of sentences(outline(operator))) {
      expect(languages.nl.has(key), `nl ${key}`).toBe(true)
      expect(languages.en.has(key), `en ${key}`).toBe(true)
    }
  })

  it('leaves no sentence of the page unused', () => {
    const used = new Set([...HEAD.map(key => `${page}.${key}`), ...operators.flatMap(operator => sentences(outline(operator)))])
    for (const [lang, messages] of Object.entries(languages)) {
      const unused = [...messages.keys()].filter(key => key.startsWith(`${page}.`) && !used.has(key))
      expect(unused, lang).toEqual([])
    }
  })

  it.each(operators)('never shows a sentence with a gap in it (%o)', (operator) => {
    for (const key of sentences(outline(operator))) {
      for (const [lang, messages] of Object.entries(languages)) {
        const asked = [...(messages.get(key) ?? '').matchAll(/\{(\w+)\}/g)].map(match => match[1])
        expect(asked.filter(name => !given(operator).includes(name!)), `${lang} ${key}`).toEqual([])
      }
    }
  })

  it('has a heading of its own for every section', () => {
    const sections = outline(art)
    expect(new Set(sections.map(section => section.id)).size).toBe(sections.length)
    for (const section of sections) expect(section.title).toBe(`${page}.${section.id}.title`)
  })
})

const blocksOf = (sections: LegalSection[], id: string) => sections.find(section => section.id === id)!.blocks
const keysOf = (sections: LegalSection[], id: string) => sentences(sections.filter(section => section.id === id))

describe('who runs the site', () => {
  it('is named on both pages when the site knows', () => {
    expect(keysOf(privacyOutline(art), 'who')).toContain('privacy.who.named')
    expect(keysOf(privacyOutline(art), 'who')).not.toContain('privacy.who.unnamed')
    expect(keysOf(termsOutline(art), 'site')).toContain('terms.site.named')
    expect(keysOf(termsOutline(art), 'site')).not.toContain('terms.site.unnamed')
  })

  it('is "the person who runs this site" when it does not', () => {
    expect(keysOf(privacyOutline(nobody), 'who')).toContain('privacy.who.unnamed')
    expect(keysOf(privacyOutline(nobody), 'who')).not.toContain('privacy.who.named')
    expect(keysOf(termsOutline(nobody), 'site')).toContain('terms.site.unnamed')
  })

  it('gets the questions at their address, as a link to mail it', () => {
    expect(blocksOf(privacyOutline(art), 'who')).toContainEqual({ kind: 'mail', address: 'art@example.test' })
    expect(keysOf(privacyOutline(art), 'who')).toContain('privacy.who.mail')
    expect(blocksOf(termsOutline(art), 'changes')).toContainEqual({ kind: 'mail', address: 'art@example.test' })
    expect(keysOf(termsOutline(art), 'changes')).toContain('terms.changes.mail')
  })

  it('is asked directly when the site has no address for them', () => {
    for (const [sections, id, key] of [[privacyOutline(nobody), 'who', 'privacy.who.ask'], [termsOutline(nobody), 'changes', 'terms.changes.ask']] as const) {
      expect(blocksOf(sections, id).some(block => block.kind === 'mail')).toBe(false)
      expect(keysOf(sections, id)).toContain(key)
    }
  })
})

describe('what stands between the visitor and the server', () => {
  it('is named on the privacy page when there is something', () => {
    expect(keysOf(privacyOutline(art), 'where')).toContain('privacy.where.network')
  })

  it('is left out when there is nothing', () => {
    expect(keysOf(privacyOutline(nobody), 'where')).not.toContain('privacy.where.network')
  })
})

describe('where the backups go', () => {
  it('is named on the privacy page when a company stores them, with how long one is kept', () => {
    expect(keysOf(privacyOutline(art), 'where')).toContain('privacy.where.backups')
    expect(keysOf(privacyOutline(art), 'keep')).toContain('privacy.keep.nightly')
    expect(keysOf(privacyOutline(art), 'keep')).not.toContain('privacy.keep.backups')
  })

  it('is left to whoever runs the site when nothing is set', () => {
    expect(keysOf(privacyOutline(nobody), 'where')).not.toContain('privacy.where.backups')
    expect(keysOf(privacyOutline(nobody), 'keep')).toContain('privacy.keep.backups')
    expect(keysOf(privacyOutline(nobody), 'keep')).not.toContain('privacy.keep.nightly')
  })
})

describe('the links on the terms page', () => {
  it('lead to the privacy page and to the source code', () => {
    expect(blocksOf(termsOutline(nobody), 'content')).toContainEqual({ kind: 'link', key: 'terms.content.privacy', to: '/privacy' })
    expect(blocksOf(termsOutline(nobody), 'software')).toContainEqual({ kind: 'link', key: 'terms.software.source', to: 'https://github.com/artvandervennet/pakske' })
  })
})
