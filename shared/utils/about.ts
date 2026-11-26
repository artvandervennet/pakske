// What the about page says, as an outline of sentences from the locale files
// (`about.<section>.<name>`), made like the privacy page's (legal.ts). Each section is a band of
// its own on the page, in this order. A link that starts with `/` is a page of this site.

import { section, type LegalSection } from './legal'
import { SOURCE_URL } from './source'

export const aboutOutline: LegalSection[] = [
  section('about', 'what', ['site', 'surprise', 'free', 'code', { kind: 'link', key: 'about.what.source', to: SOURCE_URL }]),
  section('about', 'list', ['wish', 'amount', 'import', 'note', 'more']),
  section('about', 'share', ['link', 'remembered', 'relink']),
  section('about', 'give', ['tick', 'anonymous', 'notes', 'message', 'overview']),
  section('about', 'together', ['owners', 'take', 'wishes']),
  section('about', 'friends', ['lists', 'become']),
  section('about', 'santa', ['draw', 'group', 'anonymous']),
  section('about', 'data', [
    'settings',
    'pages',
    { kind: 'link', key: 'about.data.privacy', to: '/privacy' },
    { kind: 'link', key: 'about.data.terms', to: '/terms' },
  ]),
]
