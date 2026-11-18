import { describe, expect, it } from 'vitest'
import { searchLists } from '../shared/utils/list-search'

const lists = [
  { title: 'Kerst 2026', owners: ['Art'] },
  { title: 'Verjaardag Zoë', owners: ['Lotte', 'Art'] },
  { title: 'Crème brûlée en ander lekkers', owners: ['Moeke'] },
  { title: 'Sinterklaas', owners: ['André Van der Vennet'] },
  { title: 'Zonder eigenaars', owners: [] },
]
const found = (query: string) => searchLists(lists, query).map(list => list.title)

describe('searching lists', () => {
  it('gives every list, in the given order, for an empty search', () => {
    expect(searchLists(lists, '')).toEqual(lists)
    expect(searchLists(lists, '  \t ')).toEqual(lists)
  })

  it('finds a list by a part of its title', () => {
    expect(found('kerst')).toEqual(['Kerst 2026'])
    expect(found('jaar')).toEqual(['Verjaardag Zoë'])
  })

  it('finds a list by the name of any of its owners', () => {
    expect(found('lotte')).toEqual(['Verjaardag Zoë'])
    expect(found('art')).toEqual(['Kerst 2026', 'Verjaardag Zoë'])
  })

  it('does not mind capitals', () => {
    expect(found('KERST')).toEqual(['Kerst 2026'])
    expect(found('mOEKE')).toEqual(['Crème brûlée en ander lekkers'])
  })

  it('does not mind accents, in the search or in the list', () => {
    expect(found('zoe')).toEqual(['Verjaardag Zoë'])
    expect(found('creme brulee')).toEqual(['Crème brûlée en ander lekkers'])
    expect(found('Kérst')).toEqual(['Kerst 2026'])
    expect(found('andre')).toEqual(['Sinterklaas'])
    // The same letter written as a letter plus a combining mark.
    expect(found('zoë')).toEqual(['Verjaardag Zoë'])
  })

  it('wants every word of the search somewhere, in the title or in a name', () => {
    expect(found('verjaardag lotte')).toEqual(['Verjaardag Zoë'])
    expect(found('art kerst')).toEqual(['Kerst 2026'])
    expect(found('kerst lotte')).toEqual([])
    expect(found('van vennet')).toEqual(['Sinterklaas'])
  })

  it('takes the words in any order and with any space between them', () => {
    expect(found('  2026\tkerst ')).toEqual(['Kerst 2026'])
  })

  it('finds nothing when no list has the word', () => {
    expect(found('pasen')).toEqual([])
  })

  it('keeps what else a list holds, and hands back the same rows', () => {
    const own = [{ token: 'a', title: 'Kerst', owners: ['Art'], wishes: 3 }]
    expect(searchLists(own, 'kerst')).toEqual(own)
    expect(searchLists(own, 'kerst')[0]).toBe(own[0])
  })
})
