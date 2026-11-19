// What the privacy and terms pages say, as an outline of sentences from the locale files. The
// pages are the same for every site that runs Pakske except for who runs it, so that part comes
// from the site's settings: a sentence that names them is only in the outline when the site
// knows the name.

/** Who runs this site, from NUXT_PUBLIC_OPERATOR_*. Each is '' when it isn't set. */
export interface Operator {
  /** The person or organisation that answers for the site. */
  name: string
  /** Where questions and requests about someone's data go. */
  email: string
  /** A company that carries the traffic to the server: a tunnel or a proxy. */
  network: string
}

export type LegalBlock
  = | { kind: 'text', key: string }
    | { kind: 'list', keys: string[] }
    /** An address to write to, shown as a link that opens a mail. */
    | { kind: 'mail', address: string }
    /** A link on a line of its own: a path on this site, or an address elsewhere. */
    | { kind: 'link', key: string, to: string }

export interface LegalSection {
  /** Also the section's anchor on the page. */
  id: string
  title: string
  blocks: LegalBlock[]
}

const SOURCE = 'https://github.com/artvandervennet/pakske'

/** A section of `page`: plain names become paragraphs, an array of names a list. */
function section(page: string, id: string, blocks: (string | string[] | LegalBlock)[]): LegalSection {
  const key = (name: string) => `${page}.${id}.${name}`
  return {
    id,
    title: key('title'),
    blocks: blocks.map((block): LegalBlock => {
      if (typeof block === 'string') return { kind: 'text', key: key(block) }
      if (Array.isArray(block)) return { kind: 'list', keys: block.map(key) }
      return block
    }),
  }
}

/** Where questions go: the address when the site has one, otherwise the person themselves. */
function contact(operator: Operator): (string | LegalBlock)[] {
  return operator.email ? ['mail', { kind: 'mail', address: operator.email }] : ['ask']
}

export function privacyOutline(operator: Operator): LegalSection[] {
  return [
    section('privacy', 'who', [operator.name ? 'named' : 'unnamed', ...contact(operator)]),
    section('privacy', 'what', ['intro', ['account', 'lists', 'giving', 'visited', 'sharing'], 'address', 'nothing']),
    section('privacy', 'see', ['link', 'buyers', 'owners', 'picture', 'hidden']),
    section('privacy', 'where', ['server', 'firebase', 'passwords', 'google', ...(operator.network ? ['network'] : []), 'shops', 'nobody']),
    section('privacy', 'cookies', ['intro', ['login', 'opened', 'google', 'scheme']]),
    section('privacy', 'why', ['service', 'safety']),
    section('privacy', 'keep', ['until', 'account', 'stays', 'deleted', 'erase', 'backups']),
    section('privacy', 'rights', ['self', 'ask', 'authority']),
  ]
}

export function termsOutline(operator: Operator): LegalSection[] {
  return [
    section('terms', 'site', [operator.name ? 'named' : 'unnamed', 'agree']),
    section('terms', 'account', ['name', 'password', 'full']),
    section('terms', 'lists', ['open', 'together']),
    section('terms', 'content', ['yours', { kind: 'link', key: 'terms.content.privacy', to: '/privacy' }, 'rules', 'abuse', 'removal']),
    section('terms', 'surprise', ['ask']),
    section('terms', 'giving', ['tick', 'shops']),
    section('terms', 'asis', ['offered', 'loss', 'liability']),
    section('terms', 'ending', ['you', 'site']),
    section('terms', 'software', ['open', { kind: 'link', key: 'terms.software.source', to: SOURCE }]),
    section('terms', 'changes', ['date', ...contact(operator)]),
  ]
}
