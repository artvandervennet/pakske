import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteList } from '../server/domain/lists'
import { newListToken } from '../server/domain/tokens'
import { describeLists, forgetList, listOpenedLists, mergeVisits, rememberList } from '../server/domain/visits'
import { parseOpened, withOpened } from '../server/utils/opened-lists'
import { addList, addUser, makeDb } from './helpers'

describe('opened lists in the account', () => {
  let db: ReturnType<typeof makeDb>
  let ann: number
  let bob: number
  let token: string

  beforeEach(() => {
    // Opening order is decided by timestamps, so the clock has to move between opens.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
    db = makeDb()
    ann = addUser(db, 'ann').id
    bob = addUser(db, 'bob').id
    token = addList(db, ann, 'Kerst')
  })
  afterEach(() => vi.useRealTimers())

  const later = () => vi.setSystemTime(new Date(Date.now() + 1000))

  it('puts a remembered list on the opened lists with its title and owners', () => {
    rememberList(db, bob, token)
    expect(listOpenedLists(db, bob)).toEqual([{ token, title: 'Kerst', owners: ['Ann'], deleted: false }])
  })

  it('moves a list to the front when it is opened again, without a second entry', () => {
    const other = addList(db, ann, 'Verjaardag')
    rememberList(db, bob, token)
    later()
    rememberList(db, bob, other)
    later()
    rememberList(db, bob, token)
    expect(listOpenedLists(db, bob).map(l => l.token)).toEqual([token, other])
  })

  it('never lists a list the person owns', () => {
    rememberList(db, ann, token)
    expect(listOpenedLists(db, ann)).toEqual([])
  })

  it('ignores a token that matches no list', () => {
    rememberList(db, bob, newListToken())
    expect(listOpenedLists(db, bob)).toEqual([])
  })

  it('forgets a list', () => {
    rememberList(db, bob, token)
    forgetList(db, bob, token)
    expect(listOpenedLists(db, bob)).toEqual([])
  })

  it('merges lists from a cookie, ignoring ones already there and ones the person owns', () => {
    const mine = addList(db, bob, 'Van Bob')
    const other = addList(db, ann, 'Verjaardag')
    rememberList(db, bob, token)
    mergeVisits(db, bob, [token, mine, other, newListToken()])
    expect(listOpenedLists(db, bob).map(l => l.token).sort()).toEqual([token, other].sort())
  })

  it('keeps the cookie order when merging: the first token is the newest', () => {
    const other = addList(db, ann, 'Verjaardag')
    mergeVisits(db, bob, [other, token])
    expect(listOpenedLists(db, bob).map(l => l.token)).toEqual([other, token])
  })

  it('shows a deleted list as deleted', () => {
    rememberList(db, bob, token)
    deleteList(db, ann, token)
    expect(listOpenedLists(db, bob)).toEqual([{ token, title: 'Kerst', owners: ['Ann'], deleted: true }])
  })

  it('describes the lists it can find and skips the rest', () => {
    expect(describeLists(db, [newListToken(), token]).map(l => l.token)).toEqual([token])
  })

  it('describes lists in the given order', () => {
    const other = addList(db, ann, 'Verjaardag')
    expect(describeLists(db, [other, token]).map(l => l.token)).toEqual([other, token])
  })
})

describe('the opened-lists cookie', () => {
  const good = newListToken()

  it('reads only well-formed tokens from the cookie', () => {
    expect(parseOpened(`${good}.nonsense.${good}.<script>`)).toEqual([good])
    expect(parseOpened(undefined)).toEqual([])
  })
  it('keeps the newest 50', () => {
    const fifty = Array.from({ length: 50 }, () => newListToken())
    const next = withOpened(fifty, good)
    expect(next).toHaveLength(50)
    expect(next[0]).toBe(good)
  })
  it('moves an already known token to the front', () => {
    const other = newListToken()
    expect(withOpened([other, good], good)).toEqual([good, other])
  })
  it('reads at most 50 tokens', () => {
    const many = Array.from({ length: 60 }, () => newListToken())
    expect(parseOpened(many.join('.'))).toEqual(many.slice(0, 50))
  })
})
