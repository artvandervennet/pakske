import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The sentences of the site, in both languages. Checked here because nothing else reads them all.

type Messages = { [key: string]: string | Messages }
const load = (lang: string): Messages => JSON.parse(readFileSync(`i18n/locales/${lang}.json`, 'utf8'))

/** Every sentence under its full key, such as "wish.deleteTitle". */
function flatten(messages: Messages, prefix = ''): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' ? [[prefix + key, value] as [string, string]] : flatten(value, `${prefix}${key}.`))
}

const nl = flatten(load('nl'))
const en = flatten(load('en'))

describe('the sentences in both languages', () => {
  it('have the same keys, so no page falls back to the other language', () => {
    expect(en.map(([key]) => key)).toEqual(nl.map(([key]) => key))
  })

  // Quotes are round and at the top: “…” and ’. Never straight, never low („) or angled.
  it.each([...nl.map(([key, text]) => [`nl ${key}`, text]), ...en.map(([key, text]) => [`en ${key}`, text])])('%s uses round top quotes only', (_key, text) => {
    expect(text).not.toMatch(/["'„‚«»‹›`´]/)
  })
})
