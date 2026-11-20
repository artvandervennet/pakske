import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../server/db/client'
import { purchases, santaGroups, santaMembers } from '../server/db/schema'
import { answerRequest, askFriend, listRequests, setShownToOne } from '../server/domain/friends'
import { deleteList, leaveList } from '../server/domain/lists'
import { listNotices } from '../server/domain/notices'
import { listGiven, setPurchase } from '../server/domain/purchases'
import {
  createGroup, deleteGroup, drawNames, drawnOwnersOf, drawOrder, getGroup, joinGroup, leaveGroup, listGroupLists, listGroups, removeMember, renameGroup,
  SANTA_MAX_GROUPS, SANTA_MAX_MEMBERS, setGroupList,
} from '../server/domain/santa'
import { LIST_TOKEN } from '../server/domain/tokens'
import { deleteUser, updateProfile } from '../server/domain/users'
import { listOpenedLists, listOthersLists, rememberList, takeOffPage } from '../server/domain/visits'
import type { SantaGuestView, SantaMemberView } from '../shared/schemas/santa'
import { addList, addOwner, addUser, addWishTo, codeOf, makeDb } from './helpers'

// A clock that only moves when a test moves it, so the order people joined in is the order the
// test says.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())
const later = () => vi.setSystemTime(new Date(Date.now() + 1000))

/** Art, Lotte, Mom and Sis, each with a list of their own. Art made the group "Kerst"; nobody else is in it yet. */
function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lot = addUser(db, 'lot')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const lists = { art: addList(db, art.id, 'Art'), lot: addList(db, lot.id, 'Lotte'), mom: addList(db, mom.id, 'Mom'), sis: addList(db, sis.id, 'Sis') }
  const { token } = createGroup(db, art.id, 'Kerst', lists.art)
  return { db, art, lot, mom, sis, lists, token }
}

/** The same, with all four in the group, in that order. */
function full() {
  const world = setup()
  const { db, lot, mom, sis, lists, token } = world
  for (const [user, list] of [[lot, lists.lot], [mom, lists.mom], [sis, lists.sis]] as const) {
    later()
    joinGroup(db, user.id, token, list)
  }
  return world
}

const member = (db: Db, userId: number, token: string) => getGroup(db, userId, token) as SantaMemberView
const guest = (db: Db, userId: number, token: string) => getGroup(db, userId, token) as SantaGuestView
const names = (view: SantaMemberView) => view.members.map(row => row.name)

/** Who each member drew, read straight from the table: `{ giver: receiver }` by account id. */
function draws(db: Db, token: string): Record<number, number | null> {
  const group = db.select().from(santaGroups).where(eq(santaGroups.token, token)).get()!
  return Object.fromEntries(db.select().from(santaMembers).where(eq(santaMembers.groupId, group.id)).all().map(row => [row.userId, row.givesTo]))
}

/** Writes a draw by hand, so a test knows who has whom. */
function assign(db: Db, token: string, pairs: [number, number][]) {
  const group = db.select().from(santaGroups).where(eq(santaGroups.token, token)).get()!
  db.update(santaGroups).set({ drawnAt: new Date() }).where(eq(santaGroups.id, group.id)).run()
  for (const [giver, receiver] of pairs) {
    db.update(santaMembers).set({ givesTo: receiver }).where(and(eq(santaMembers.groupId, group.id), eq(santaMembers.userId, giver))).run()
  }
}

describe('making a group', () => {
  it('gives it an address of its own and makes its maker the first member, who runs it', () => {
    const { db, art, lists, token } = setup()
    expect(token).toMatch(LIST_TOKEN)
    const view = member(db, art.id, token)
    expect(view).toMatchObject({ role: 'member', title: 'Kerst', drawn: false, organiser: true, pick: null })
    expect(view.members).toEqual([{ id: art.id, name: 'Art', picture: null, you: true, organiser: true, list: { token: lists.art, title: 'Art' }, waiting: false }])
    expect(listGroups(db, art.id)).toEqual([{ token, title: 'Kerst', members: 1, drawn: false, again: false, organiser: true }])
  })

  it('takes a list of the maker\'s own, or none, and never someone else\'s', () => {
    const { db, art, lists } = setup()
    const without = createGroup(db, art.id, 'Zonder', null).token
    expect(member(db, art.id, without)).toMatchObject({ list: null })
    expect(member(db, art.id, without).members[0]!.list).toBeNull()
    expect(codeOf(() => createGroup(db, art.id, 'Gestolen', lists.lot))).toBe('not_found')
  })

  it('stops at the number of groups one person can be in', () => {
    const { db, lot } = setup()
    for (let n = 0; n < SANTA_MAX_GROUPS; n++) createGroup(db, lot.id, `Groep ${n}`, null)
    expect(codeOf(() => createGroup(db, lot.id, 'Eén te veel', null))).toBe('santa_limit')
  })

  it('lets only the person who runs it rename it', () => {
    const { db, art, lot, token } = setup()
    joinGroup(db, lot.id, token, null)
    renameGroup(db, art.id, token, 'Kerst 2026')
    expect(member(db, lot.id, token).title).toBe('Kerst 2026')
    expect(codeOf(() => renameGroup(db, lot.id, token, 'Van Lotte'))).toBe('forbidden')
  })
})

describe('joining a group', () => {
  it('shows someone who has the link what they would join, and nothing about who is in it', () => {
    const { db, lot, lists, token } = setup()
    expect(guest(db, lot.id, token)).toEqual({
      role: 'guest',
      title: 'Kerst',
      organiser: 'Art',
      members: 1,
      state: 'open',
      mine: { lists: [{ token: lists.lot, title: 'Lotte' }], last: null },
    })
  })

  it('answers nothing for an address no group has', () => {
    const { db, lot } = setup()
    expect(getGroup(db, lot.id, 'AAAAAAAAAAAAAAAAAAAAAA')).toBeUndefined()
    expect(codeOf(() => joinGroup(db, lot.id, 'AAAAAAAAAAAAAAAAAAAAAA', null))).toBe('not_found')
  })

  it('makes them a member with the list they chose, and tells whoever runs the group', () => {
    const { db, art, lot, lists, token } = setup()
    later()
    joinGroup(db, lot.id, token, lists.lot)
    expect(names(member(db, lot.id, token))).toEqual(['Art', 'Lot'])
    expect(member(db, lot.id, token)).toMatchObject({ organiser: false, list: lists.lot })
    expect(listNotices(db, art.id)).toMatchObject([{ kind: 'santa_joined', actor: 'Lot', title: 'Kerst', santa: token }])
    expect(listNotices(db, lot.id)).toEqual([])
  })

  it('refuses a list that isn\'t theirs, and leaves them out', () => {
    const { db, lot, lists, token } = setup()
    expect(codeOf(() => joinGroup(db, lot.id, token, lists.art))).toBe('not_found')
    expect(guest(db, lot.id, token).role).toBe('guest')
  })

  it('leaves someone who is in it already as they are', () => {
    const { db, art, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    joinGroup(db, lot.id, token, null)
    expect(member(db, lot.id, token).list).toBe(lists.lot)
    expect(listNotices(db, art.id)).toHaveLength(1)
  })

  it('stops at the most people a group holds', () => {
    const { db, token } = setup()
    for (let n = 1; n < SANTA_MAX_MEMBERS; n++) joinGroup(db, addUser(db, `extra${n}`).id, token, null)
    const late = addUser(db, 'late')
    expect(guest(db, late.id, token).state).toBe('full')
    expect(codeOf(() => joinGroup(db, late.id, token, null))).toBe('santa_full')
  })

  it('counts toward the groups one person can be in', () => {
    const { db, lot, token } = setup()
    for (let n = 0; n < SANTA_MAX_GROUPS; n++) createGroup(db, lot.id, `Groep ${n}`, null)
    expect(codeOf(() => joinGroup(db, lot.id, token, null))).toBe('santa_limit')
  })
})

describe('the list a member puts in', () => {
  it('can be changed and taken out, by that member alone', () => {
    const { db, art, lot, lists, token } = setup()
    const second = addList(db, art.id, 'Tweede')
    setGroupList(db, art.id, token, second)
    expect(member(db, art.id, token).list).toBe(second)
    setGroupList(db, art.id, token, null)
    expect(member(db, art.id, token)).toMatchObject({ list: null })
    expect(codeOf(() => setGroupList(db, art.id, token, lists.lot))).toBe('not_found')
    // Someone who isn't in the group can't tell it from one that doesn't exist.
    expect(codeOf(() => setGroupList(db, lot.id, token, lists.lot))).toBe('not_found')
  })

  it('no longer counts once the list is deleted or no longer theirs', () => {
    const { db, art, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    deleteList(db, art.id, lists.art)
    expect(member(db, lot.id, token).members.map(row => row.list?.title ?? null)).toEqual([null, 'Lotte'])
    expect(member(db, art.id, token).list).toBeNull()
    addOwner(db, lists.lot, art.id)
    leaveList(db, lot.id, lists.lot)
    expect(member(db, art.id, token).members.map(row => row.list?.title ?? null)).toEqual([null, null])
  })
})

describe('the lists of a group', () => {
  const theirs = (db: Db, userId: number) => listOthersLists(db, userId).map(list => [list.title, list.santa ?? null])

  it('are on the group\'s page for every member, each with whose it is', () => {
    const { db, art, sis, lists, token } = full()
    setGroupList(db, sis.id, token, null)
    for (const viewer of [art, sis]) {
      expect(member(db, viewer.id, token).members.map(row => row.list)).toEqual([
        { token: lists.art, title: 'Art' }, { token: lists.lot, title: 'Lotte' }, { token: lists.mom, title: 'Mom' }, null,
      ])
    }
  })

  it('are not shown to someone who only has the link', () => {
    const { db, token } = full()
    const outsider = addUser(db, 'out')
    expect(JSON.stringify(getGroup(db, outsider.id, token))).not.toMatch(/Lotte|"list"/)
    expect(listGroupLists(db, outsider.id)).toEqual([])
  })

  it('are among a member\'s lists of others without anyone sending a link, and say which group put them there', () => {
    const { db, art, lot, lists, token } = setup()
    expect(theirs(db, lot.id)).toEqual([])
    later()
    joinGroup(db, lot.id, token, lists.lot)
    expect(listOthersLists(db, lot.id)).toEqual([{ token: lists.art, title: 'Art', owners: ['Art'], deleted: false, santa: ['Kerst'] }])
    expect(theirs(db, art.id)).toEqual([['Lotte', ['Kerst']]])
  })

  it('never include the member\'s own list, or one they own with someone', () => {
    const { db, art, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    addOwner(db, lists.lot, art.id)
    expect(theirs(db, art.id)).toEqual([])
  })

  it('follow what a member puts in: another list, none, a list that is deleted', () => {
    const { db, art, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    const second = addList(db, art.id, 'Tweede')
    setGroupList(db, art.id, token, second)
    expect(theirs(db, lot.id)).toEqual([['Tweede', ['Kerst']]])
    setGroupList(db, art.id, token, null)
    expect(theirs(db, lot.id)).toEqual([])
    setGroupList(db, art.id, token, second)
    deleteList(db, art.id, second)
    expect(theirs(db, lot.id)).toEqual([])
  })

  it('go off the page with the group: leaving it, being taken out, the group ending', () => {
    const { db, art, lot, mom, token } = full()
    expect(theirs(db, lot.id).map(([title]) => title).sort()).toEqual(['Art', 'Mom', 'Sis'])
    leaveGroup(db, lot.id, token)
    expect(theirs(db, lot.id)).toEqual([])
    expect(theirs(db, mom.id).map(([title]) => title).sort()).toEqual(['Art', 'Sis'])
    removeMember(db, art.id, token, mom.id)
    expect(theirs(db, mom.id)).toEqual([])
    deleteGroup(db, art.id, token)
    expect(theirs(db, art.id)).toEqual([])
  })

  it('are not remembered as opened, so they leave with the group', () => {
    const { db, art, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    rememberList(db, lot.id, lists.art)
    expect(listOpenedLists(db, lot.id)).toEqual([])
    expect(theirs(db, lot.id)).toEqual([['Art', ['Kerst']]])
    leaveGroup(db, lot.id, token)
    expect(theirs(db, art.id)).toEqual([])
    expect(theirs(db, lot.id)).toEqual([])
  })

  it('are there once when the member opened the list before: as the group\'s, and as theirs again afterwards', () => {
    const { db, lot, lists, token } = setup()
    rememberList(db, lot.id, lists.art)
    expect(theirs(db, lot.id)).toEqual([['Art', null]])
    joinGroup(db, lot.id, token, lists.lot)
    expect(theirs(db, lot.id)).toEqual([['Art', ['Kerst']]])
    leaveGroup(db, lot.id, token)
    expect(theirs(db, lot.id)).toEqual([['Art', null]])
  })

  it('are there once when a friend shows the list too, as the friend\'s', () => {
    const { db, art, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    askFriend(db, lot.id, lists.art, art.id)
    answerRequest(db, art.id, listRequests(db, art.id).incoming[0]!.id, true)
    setShownToOne(db, art.id, lists.art, lot.id, true)
    expect(theirs(db, lot.id)).toEqual([['Art', null]])
  })

  it('name every group that puts a list there, once', () => {
    const { db, art, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    later()
    const second = createGroup(db, lot.id, 'Nieuwjaar', lists.lot).token
    joinGroup(db, art.id, second, lists.art)
    expect(theirs(db, lot.id)).toEqual([['Art', ['Nieuwjaar', 'Kerst']]])
  })

  it('stay on the page when "Weghalen" is asked: they go with the group, not by themselves', () => {
    const { db, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    takeOffPage(db, lot.id, lists.art)
    expect(theirs(db, lot.id)).toEqual([['Art', ['Kerst']]])
  })

  it('count as lists the member has: what they tick there is among what they give', () => {
    const { db, art, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    const wish = addWishTo(db, art.id, lists.art, 'Sokken')
    setPurchase(db, lists.art, wish.id, lot.id, 1)
    expect(listGiven(db, lot.id)).toMatchObject([{ names: ['Art'], wishes: [{ title: 'Sokken', token: lists.art }] }])
  })
})

describe('leaving before the draw', () => {
  it('takes the member out', () => {
    const { db, art, lot, token } = full()
    leaveGroup(db, lot.id, token)
    expect(names(member(db, art.id, token))).toEqual(['Art', 'Mom', 'Sis'])
    expect(guest(db, lot.id, token).role).toBe('guest')
    expect(listGroups(db, lot.id)).toEqual([])
  })

  it('hands the group to whoever joined next when the person who runs it leaves', () => {
    const { db, art, lot, mom, token } = full()
    leaveGroup(db, art.id, token)
    expect(member(db, lot.id, token).organiser).toBe(true)
    expect(member(db, mom.id, token).organiser).toBe(false)
    expect(member(db, mom.id, token).members[0]).toMatchObject({ name: 'Lot', organiser: true })
  })

  it('ends the group when the last member leaves', () => {
    const { db, art, token } = setup()
    leaveGroup(db, art.id, token)
    expect(getGroup(db, art.id, token)).toBeUndefined()
  })

  it('is "not found" for someone who isn\'t in it', () => {
    const { db, lot, token } = setup()
    expect(codeOf(() => leaveGroup(db, lot.id, token))).toBe('not_found')
  })
})

describe('taking someone out before the draw', () => {
  it('is for the person who runs the group, and tells the one taken out', () => {
    const { db, art, lot, mom, token } = full()
    expect(codeOf(() => removeMember(db, lot.id, token, mom.id))).toBe('forbidden')
    removeMember(db, art.id, token, mom.id)
    expect(names(member(db, art.id, token))).toEqual(['Art', 'Lot', 'Sis'])
    // They are no longer in it, so the notice leads nowhere.
    expect(listNotices(db, mom.id)).toMatchObject([{ kind: 'santa_removed', actor: 'Art', title: 'Kerst', santa: null }])
  })

  it('never takes out the person who runs it, or someone who isn\'t in it', () => {
    const { db, art, token } = full()
    const stranger = addUser(db, 'stranger')
    expect(codeOf(() => removeMember(db, art.id, token, art.id))).toBe('forbidden')
    expect(codeOf(() => removeMember(db, art.id, token, stranger.id))).toBe('not_found')
  })
})

describe('the order names are drawn in', () => {
  it('never gives anyone their own name, and gives every name to one person', () => {
    for (let run = 0; run < 200; run++) {
      const ids = [1, 2, 3, 4, 5]
      const drawn = drawOrder(ids)
      expect([...drawn].sort()).toEqual(ids)
      expect(drawn.some((id, index) => id === ids[index])).toBe(false)
    }
  })

  it('can come out every way there is: with four people, all nine', () => {
    const seen = new Set<string>()
    for (let run = 0; run < 2000; run++) seen.add(drawOrder([1, 2, 3, 4]).join(''))
    expect(seen.size).toBe(9)
  })

  it('has nothing to draw with one person', () => {
    expect(codeOf(() => drawOrder([1]))).toBe('santa_too_few')
  })
})

describe('drawing the names', () => {
  it('needs three people, and the person who runs the group', () => {
    const { db, art, lot, lists, token } = setup()
    joinGroup(db, lot.id, token, lists.lot)
    expect(codeOf(() => drawNames(db, art.id, token))).toBe('santa_too_few')
    const { db: db4, lot: lot4, token: token4 } = full()
    expect(codeOf(() => drawNames(db4, lot4.id, token4))).toBe('forbidden')
    expect(member(db4, lot4.id, token4).drawn).toBe(false)
  })

  it('gives every member one other member, and every member to one', () => {
    const { db, art, lot, mom, sis, token } = full()
    drawNames(db, art.id, token)
    const drawn = draws(db, token)
    const ids = [art.id, lot.id, mom.id, sis.id]
    expect(Object.values(drawn).sort()).toEqual(ids)
    for (const id of ids) expect(drawn[id]).not.toBe(id)
  })

  it('shows each member the name they drew, with the list that person put in', () => {
    const { db, art, lot, mom, sis, lists, token } = full()
    assign(db, token, [[art.id, lot.id], [lot.id, mom.id], [mom.id, sis.id], [sis.id, art.id]])
    expect(member(db, art.id, token)).toMatchObject({ drawn: true, pick: { id: lot.id, name: 'Lot', list: { token: lists.lot, title: 'Lotte' } } })
    expect(member(db, sis.id, token).pick).toMatchObject({ id: art.id, name: 'Art', list: { token: lists.art, title: 'Art' } })
    // A list that was taken out, or deleted since, is not handed on.
    setGroupList(db, lot.id, token, null)
    expect(member(db, art.id, token).pick).toMatchObject({ name: 'Lot', list: null })
  })

  it('tells the other members that it happened', () => {
    const { db, art, lot, token } = full()
    drawNames(db, art.id, token)
    expect(listNotices(db, lot.id)).toMatchObject([{ kind: 'santa_drawn', actor: 'Art', title: 'Kerst', santa: token }])
    expect(listNotices(db, art.id).some(notice => notice.kind === 'santa_drawn')).toBe(false)
  })

  it('happens once: with a name for everyone, nobody draws again', () => {
    const { db, art, lot, token } = full()
    drawNames(db, art.id, token)
    const before = draws(db, token)
    expect(codeOf(() => drawNames(db, art.id, token))).toBe('santa_drawn')
    expect(codeOf(() => drawNames(db, lot.id, token))).toBe('forbidden')
    expect(draws(db, token)).toEqual(before)
    expect(member(db, lot.id, token)).toMatchObject({ drawn: true, lapsed: false, waits: null })
    expect(listGroups(db, lot.id)).toMatchObject([{ drawn: true, again: false }])
    expect(member(db, lot.id, token).members.some(row => row.waiting)).toBe(false)
  })
})

describe('someone who joins after the draw', () => {
  /** The four drew; Lars joins afterwards with a list of his own. */
  function late() {
    const world = full()
    const { db, art, lot, mom, sis, token } = world
    assign(db, token, [[art.id, lot.id], [lot.id, mom.id], [mom.id, sis.id], [sis.id, art.id]])
    later()
    const lars = addUser(db, 'lars')
    const larsList = addList(db, lars.id, 'Lars')
    return { ...world, lars, larsList }
  }

  it('is told the names are drawn, and can still join', () => {
    const { db, lars, larsList, token } = late()
    expect(guest(db, lars.id, token)).toMatchObject({ role: 'guest', state: 'drawn', organiser: 'Art', members: 4 })
    joinGroup(db, lars.id, token, larsList)
    expect(names(member(db, lars.id, token))).toEqual(['Art', 'Lot', 'Mom', 'Sis', 'Lars'])
  })

  it('has no name yet, changes nobody else\'s, and everyone sees who waits', () => {
    const { db, art, lot, lars, larsList, token } = late()
    const before = draws(db, token)
    joinGroup(db, lars.id, token, larsList)
    expect(draws(db, token)).toEqual({ ...before, [lars.id]: null })
    expect(member(db, lars.id, token)).toMatchObject({ drawn: true, pick: null, waits: 'late' })
    expect(member(db, art.id, token)).toMatchObject({ pick: { id: lot.id }, waits: null })
    expect(member(db, lot.id, token).members.map(row => row.waiting)).toEqual([false, false, false, false, true])
    expect(listGroups(db, art.id)).toMatchObject([{ drawn: true, again: true }])
  })

  it('tells whoever runs the group that the names must be drawn again', () => {
    const { db, art, lot, lars, token } = late()
    joinGroup(db, lars.id, token, null)
    expect(listNotices(db, art.id)[0]).toMatchObject({ kind: 'santa_joined_late', actor: 'Lars', title: 'Kerst', santa: token })
    expect(listNotices(db, lot.id).some(notice => notice.actor === 'Lars')).toBe(false)
  })

  it('can leave again, or be taken out, while the others stay as they are', () => {
    const { db, art, lot, lars, token } = late()
    joinGroup(db, lars.id, token, null)
    leaveGroup(db, lars.id, token)
    expect(names(member(db, art.id, token))).toEqual(['Art', 'Lot', 'Mom', 'Sis'])
    joinGroup(db, lars.id, token, null)
    expect(codeOf(() => removeMember(db, lot.id, token, lars.id))).toBe('forbidden')
    removeMember(db, art.id, token, lars.id)
    expect(names(member(db, art.id, token))).toEqual(['Art', 'Lot', 'Mom', 'Sis'])
    // Nobody had his name and he had nobody's: the draw is as it was, and nobody else is told.
    expect(member(db, art.id, token)).toMatchObject({ lapsed: false, pick: { id: lot.id } })
    expect(listNotices(db, lot.id)).toEqual([])
  })

  it('gets a name when the names are drawn again, as everyone does, the person who runs the group alone doing it', () => {
    const { db, art, lot, mom, sis, lars, token } = late()
    joinGroup(db, lars.id, token, null)
    expect(codeOf(() => drawNames(db, lot.id, token))).toBe('forbidden')
    expect(codeOf(() => drawNames(db, lars.id, token))).toBe('forbidden')
    drawNames(db, art.id, token)
    const drawn = draws(db, token)
    const ids = [art.id, lot.id, mom.id, sis.id, lars.id]
    expect(Object.values(drawn).sort()).toEqual(ids)
    for (const id of ids) expect(drawn[id]).not.toBe(id)
    expect(member(db, lars.id, token)).toMatchObject({ waits: null })
    expect(member(db, lars.id, token).pick).not.toBeNull()
    expect(member(db, art.id, token).members.some(row => row.waiting)).toBe(false)
  })

  it('makes a new draw of everyone: over many, each name comes to each member', () => {
    const seen = new Set<number>()
    for (let run = 0; run < 60; run++) {
      const { db, art, lars, token } = late()
      joinGroup(db, lars.id, token, null)
      drawNames(db, art.id, token)
      seen.add(draws(db, token)[art.id]!)
    }
    // Art had Lotte; a draw that only fitted the newcomer in would leave him with her or with Lars.
    expect(seen.size).toBe(4)
  })

  it('tells everyone else that the names were drawn again', () => {
    const { db, art, lot, mom, sis, lars, token } = late()
    joinGroup(db, lars.id, token, null)
    later()
    drawNames(db, art.id, token)
    for (const user of [lot, mom, sis, lars]) {
      expect(listNotices(db, user.id)[0], user.displayName).toMatchObject({ kind: 'santa_redrawn', actor: 'Art', title: 'Kerst', santa: token, fresh: true })
    }
    expect(listNotices(db, art.id).some(notice => notice.kind === 'santa_redrawn')).toBe(false)
  })

  it('is the only reason to draw again: afterwards the draw stands', () => {
    const { db, art, lars, token } = late()
    joinGroup(db, lars.id, token, null)
    drawNames(db, art.id, token)
    const after = draws(db, token)
    expect(codeOf(() => drawNames(db, art.id, token))).toBe('santa_drawn')
    expect(draws(db, token)).toEqual(after)
  })
})

describe('someone with a name who leaves, or is taken out', () => {
  /** The four drew: Art has Lotte, Lotte has Mom, Mom has Sis, Sis has Art. */
  function drawn() {
    const world = full()
    const { db, art, lot, mom, sis, token } = world
    assign(db, token, [[art.id, lot.id], [lot.id, mom.id], [mom.id, sis.id], [sis.id, art.id]])
    later()
    return world
  }

  it('can always go, and the draw goes with them: nobody keeps a name', () => {
    const { db, art, lot, mom, sis, token } = drawn()
    leaveGroup(db, lot.id, token)
    expect(draws(db, token)).toEqual({ [art.id]: null, [mom.id]: null, [sis.id]: null })
    expect(names(member(db, art.id, token))).toEqual(['Art', 'Mom', 'Sis'])
    expect(guest(db, lot.id, token)).toMatchObject({ role: 'guest', state: 'open' })
  })

  it('leaves everyone the same page: a draw that no longer counts, and nobody singled out', () => {
    const { db, art, lot, mom, sis, token } = drawn()
    leaveGroup(db, lot.id, token)
    // Art had her name and Mom was hers: neither reads differently from Sis.
    for (const user of [art, mom, sis]) {
      expect(member(db, user.id, token), user.displayName).toMatchObject({ drawn: true, lapsed: true, pick: null, waits: 'lapsed' })
      expect(member(db, user.id, token).members.some(row => row.waiting)).toBe(false)
    }
    expect(listGroups(db, mom.id)).toMatchObject([{ drawn: true, again: true }])
  })

  it('tells everyone who stays, by the name of who went', () => {
    const { db, art, lot, mom, sis, token } = drawn()
    leaveGroup(db, lot.id, token)
    for (const user of [art, mom, sis]) {
      expect(listNotices(db, user.id)[0], user.displayName).toMatchObject({ kind: 'santa_lapsed', actor: 'Lot', title: 'Kerst', santa: token, fresh: true })
    }
    expect(listNotices(db, lot.id).some(notice => notice.kind === 'santa_lapsed')).toBe(false)
  })

  it('is the same when the person who runs the group takes them out, who is told that instead', () => {
    const { db, art, lot, mom, sis, token } = drawn()
    expect(codeOf(() => removeMember(db, mom.id, token, lot.id))).toBe('forbidden')
    removeMember(db, art.id, token, lot.id)
    expect(draws(db, token)).toEqual({ [art.id]: null, [mom.id]: null, [sis.id]: null })
    expect(listNotices(db, lot.id)[0]).toMatchObject({ kind: 'santa_removed', actor: 'Art', santa: null })
    for (const user of [mom, sis]) expect(listNotices(db, user.id)[0]).toMatchObject({ kind: 'santa_lapsed', actor: 'Lot', santa: token })
    // Art did it himself: his page says so, and no notice.
    expect(listNotices(db, art.id).some(notice => notice.kind === 'santa_lapsed')).toBe(false)
  })

  it('hands the group on when it is the person who runs it', () => {
    const { db, art, lot, mom, token } = drawn()
    leaveGroup(db, art.id, token)
    expect(member(db, lot.id, token)).toMatchObject({ organiser: true, lapsed: true })
    expect(member(db, mom.id, token).organiser).toBe(false)
  })

  it('lets the names be drawn again for everyone who stays, and tells them', () => {
    const { db, art, lot, mom, sis, token } = drawn()
    leaveGroup(db, lot.id, token)
    expect(codeOf(() => drawNames(db, mom.id, token))).toBe('forbidden')
    later()
    drawNames(db, art.id, token)
    const again = draws(db, token)
    expect(Object.values(again).sort()).toEqual([art.id, mom.id, sis.id])
    for (const id of [art.id, mom.id, sis.id]) expect(again[id]).not.toBe(id)
    expect(member(db, mom.id, token)).toMatchObject({ drawn: true, lapsed: false, waits: null })
    expect(listNotices(db, mom.id)[0]).toMatchObject({ kind: 'santa_redrawn', actor: 'Art' })
    expect(listGroups(db, mom.id)).toMatchObject([{ drawn: true, again: false }])
  })

  it('can leave fewer than a draw needs: it waits until someone joins', () => {
    const { db, art, lot, mom, sis, token } = drawn()
    leaveGroup(db, lot.id, token)
    leaveGroup(db, mom.id, token)
    expect(codeOf(() => drawNames(db, art.id, token))).toBe('santa_too_few')
    // A draw that no longer counts is joined like a group that never drew.
    expect(guest(db, lot.id, token).state).toBe('open')
    joinGroup(db, lot.id, token, null)
    expect(listNotices(db, art.id)[0]).toMatchObject({ kind: 'santa_joined', actor: 'Lot' })
    expect(member(db, lot.id, token)).toMatchObject({ lapsed: true, waits: 'lapsed' })
    drawNames(db, art.id, token)
    expect(Object.values(draws(db, token)).sort()).toEqual([art.id, lot.id, sis.id].sort())
  })

  it('tells nobody a second time while the draw no longer counts', () => {
    const { db, art, lot, mom, sis, token } = drawn()
    leaveGroup(db, lot.id, token)
    leaveGroup(db, mom.id, token)
    expect(listNotices(db, sis.id).filter(notice => notice.kind === 'santa_lapsed')).toHaveLength(1)
    expect(listNotices(db, art.id).filter(notice => notice.kind === 'santa_lapsed')).toHaveLength(1)
  })

  it('ends the group when the last one leaves', () => {
    const { db, art, lot, mom, sis, token } = drawn()
    for (const user of [art, lot, mom, sis]) leaveGroup(db, user.id, token)
    expect(getGroup(db, art.id, token)).toBeUndefined()
  })
})

describe('who drew whom', () => {
  /** Art drew Lotte and Mom drew Sis in both; who Lotte and Sis drew differs. */
  function twoDraws() {
    const one = full()
    assign(one.db, one.token, [[one.art.id, one.lot.id], [one.lot.id, one.mom.id], [one.mom.id, one.sis.id], [one.sis.id, one.art.id]])
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'))
    const other = full()
    assign(other.db, other.token, [[other.art.id, other.lot.id], [other.lot.id, other.art.id], [other.mom.id, other.sis.id], [other.sis.id, other.mom.id]])
    return { one, other }
  }
  /** A view without the addresses, which are random and so never the same twice. */
  const comparable = (view: unknown) => JSON.parse(JSON.stringify(view).replace(/[A-Za-z0-9_-]{22}/g, 'TOKEN'))

  it('is not in anything a member gets, beyond their own name: the person who runs the group included', () => {
    const { one, other } = twoDraws()
    // Mom drew Sis in both, and runs nothing.
    expect(comparable(getGroup(one.db, one.mom.id, one.token))).toEqual(comparable(getGroup(other.db, other.mom.id, other.token)))
    expect(member(one.db, one.mom.id, one.token).pick?.name).toBe('Sis')
    expect(comparable(getGroup(one.db, one.art.id, one.token))).toEqual(comparable(getGroup(other.db, other.art.id, other.token)))
    expect(comparable(listGroups(one.db, one.art.id))).toEqual(comparable(listGroups(other.db, other.art.id)))
    // A notice's id is random too.
    const told = (world: typeof one) => comparable(listNotices(world.db, world.art.id).map(notice => ({ ...notice, id: '' })))
    expect(told(one)).toEqual(told(other))
    expect(told(one)).toHaveLength(3)
  })

  it('is not in what someone outside the group gets', () => {
    const { one, other } = twoDraws()
    const outsiderOne = addUser(one.db, 'out')
    const outsiderOther = addUser(other.db, 'out')
    expect(getGroup(one.db, outsiderOne.id, one.token)).toEqual(getGroup(other.db, outsiderOther.id, other.token))
  })

  it('never leaves the rules with a name: only the member\'s own row is read', () => {
    const { one } = twoDraws()
    const view = JSON.stringify(getGroup(one.db, one.lot.id, one.token))
    expect(view).not.toMatch(/givesTo|gives_to/)
    // Lotte drew Mom. Sis, whom Mom drew, is in her view as a member and nowhere as a pick.
    expect(member(one.db, one.lot.id, one.token).pick?.name).toBe('Mom')
  })
})

describe('ending a group', () => {
  it('is for the person who runs it, before or after the draw, and takes its notices along', () => {
    const { db, art, lot, token } = full()
    drawNames(db, art.id, token)
    expect(codeOf(() => deleteGroup(db, lot.id, token))).toBe('forbidden')
    deleteGroup(db, art.id, token)
    expect(getGroup(db, lot.id, token)).toBeUndefined()
    expect(listGroups(db, lot.id)).toEqual([])
    expect(listNotices(db, lot.id)).toEqual([])
    expect(listNotices(db, art.id)).toEqual([])
  })
})

describe('an account that is deleted', () => {
  it('leaves a group that hasn\'t drawn yet, and whoever joined next runs it', () => {
    const { db, art, lot, token } = full()
    deleteUser(db, art.id)
    expect(names(member(db, lot.id, token))).toEqual(['Lot', 'Mom', 'Sis'])
    expect(member(db, lot.id, token).organiser).toBe(true)
  })

  it('hands the name it drew to whoever drew it, so nobody is left out', () => {
    const { db, art, lot, mom, sis, token } = full()
    assign(db, token, [[art.id, lot.id], [lot.id, mom.id], [mom.id, sis.id], [sis.id, art.id]])
    deleteUser(db, lot.id)
    expect(draws(db, token)).toEqual({ [art.id]: mom.id, [mom.id]: sis.id, [sis.id]: art.id })
    expect(member(db, art.id, token).pick?.name).toBe('Mom')
  })

  it('leaves the one person who drew it and was drawn by it with nobody', () => {
    const { db, art, lot, mom, sis, token } = full()
    assign(db, token, [[art.id, lot.id], [lot.id, art.id], [mom.id, sis.id], [sis.id, mom.id]])
    deleteUser(db, lot.id)
    expect(draws(db, token)).toEqual({ [art.id]: null, [mom.id]: sis.id, [sis.id]: mom.id })
    expect(member(db, art.id, token)).toMatchObject({ drawn: true, pick: null, waits: 'gone' })
    expect(member(db, mom.id, token).members.map(row => row.waiting)).toEqual([true, false, false])
  })

  it('lets the names be drawn again for the one it left with nobody', () => {
    const { db, art, lot, mom, sis, token } = full()
    assign(db, token, [[art.id, lot.id], [lot.id, art.id], [mom.id, sis.id], [sis.id, mom.id]])
    deleteUser(db, lot.id)
    drawNames(db, art.id, token)
    expect(Object.values(draws(db, token)).sort()).toEqual([art.id, mom.id, sis.id])
    expect(member(db, art.id, token)).toMatchObject({ waits: null })
  })

  it('takes a group along that had nobody else in it', () => {
    const { db, art, token } = setup()
    deleteUser(db, art.id)
    expect(db.select().from(santaGroups).where(eq(santaGroups.token, token)).all()).toEqual([])
  })
})

describe('giving to the person whose name you drew', () => {
  /** Art drew Lotte; Mom is in the group too and drew someone else. Lotte's list has a wish. */
  function drawn() {
    const world = full()
    const { db, art, lot, mom, sis, lists, token } = world
    assign(db, token, [[art.id, lot.id], [lot.id, mom.id], [mom.id, sis.id], [sis.id, art.id]])
    const wish = addWishTo(db, lot.id, lists.lot, 'Boek', null)
    return { ...world, wish }
  }
  const anonymousOf = (db: Db, wishId: number, userId: number) =>
    db.select({ anonymous: purchases.anonymous }).from(purchases).where(and(eq(purchases.wishId, wishId), eq(purchases.userId, userId))).get()!.anonymous

  it('is without your name, so the other members can\'t read the draw from the list', () => {
    const { db, art, mom, lists, wish } = drawn()
    setPurchase(db, lists.lot, wish.id, art.id, 1)
    setPurchase(db, lists.lot, wish.id, mom.id, 1)
    expect(anonymousOf(db, wish.id, art.id)).toBe(true)
    // Mom didn't draw Lotte: her tick goes by her own setting.
    expect(anonymousOf(db, wish.id, mom.id)).toBe(false)
  })

  it('is with your name when you say so on the wish, and stays as it is afterwards', () => {
    const { db, art, lists, wish } = drawn()
    setPurchase(db, lists.lot, wish.id, art.id, 1, false)
    expect(anonymousOf(db, wish.id, art.id)).toBe(false)
    setPurchase(db, lists.lot, wish.id, art.id, 2)
    expect(anonymousOf(db, wish.id, art.id)).toBe(false)
  })

  it('changes nothing before the names are drawn, or for a group that ended', () => {
    const { db, art, lot, lists } = full()
    const wish = addWishTo(db, lot.id, lists.lot, 'Boek', null)
    setPurchase(db, lists.lot, wish.id, art.id, 1)
    expect(anonymousOf(db, wish.id, art.id)).toBe(false)
    const ended = drawn()
    deleteGroup(ended.db, ended.art.id, ended.token)
    setPurchase(ended.db, ended.lists.lot, ended.wish.id, ended.art.id, 1)
    expect(anonymousOf(ended.db, ended.wish.id, ended.art.id)).toBe(false)
  })

  it('still follows "Standaard anoniem geven" for everyone else', () => {
    const { db, mom, lists, wish } = drawn()
    updateProfile(db, mom.id, { anonymousDefault: true })
    setPurchase(db, lists.lot, wish.id, mom.id, 1)
    expect(anonymousOf(db, wish.id, mom.id)).toBe(true)
  })

  it('is said on the list of the person you drew, and on no other', () => {
    const { db, art, mom, lists } = drawn()
    expect(drawnOwnersOf(db, art.id, lists.lot)).toEqual(['Lot'])
    expect(drawnOwnersOf(db, art.id, lists.mom)).toEqual([])
    expect(drawnOwnersOf(db, mom.id, lists.lot)).toEqual([])
    expect(drawnOwnersOf(db, art.id, 'AAAAAAAAAAAAAAAAAAAAAA')).toEqual([])
  })
})

describe('the groups on a person\'s page', () => {
  it('are the ones they are in, the one joined last first', () => {
    const { db, art, lot, token } = setup()
    later()
    const second = createGroup(db, lot.id, 'Nieuwjaar', null).token
    later()
    joinGroup(db, art.id, second, null)
    expect(listGroups(db, art.id).map(group => group.title)).toEqual(['Nieuwjaar', 'Kerst'])
    expect(listGroups(db, art.id)).toMatchObject([{ token: second, members: 2, organiser: false }, { token, members: 1, organiser: true }])
    expect(listGroups(db, lot.id).map(group => group.title)).toEqual(['Nieuwjaar'])
  })
})

describe('the rules of Secret Santa', () => {
  it('never read what anyone ticked or wrote on a list', () => {
    expect(readFileSync('server/domain/santa.ts', 'utf8')).not.toMatch(/purchases|notes/i)
  })
})
