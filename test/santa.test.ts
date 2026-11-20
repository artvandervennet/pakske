import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../server/db/client'
import { purchases, santaGroups, santaMembers } from '../server/db/schema'
import { deleteList, leaveList } from '../server/domain/lists'
import { listNotices } from '../server/domain/notices'
import { setPurchase } from '../server/domain/purchases'
import {
  createGroup, deleteGroup, drawNames, drawnOwnersOf, drawOrder, getGroup, joinGroup, leaveGroup, listGroups, removeMember, renameGroup,
  SANTA_MAX_GROUPS, SANTA_MAX_MEMBERS, setGroupList,
} from '../server/domain/santa'
import { LIST_TOKEN } from '../server/domain/tokens'
import { deleteUser, updateProfile } from '../server/domain/users'
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
    const { db, art, token } = setup()
    expect(token).toMatch(LIST_TOKEN)
    const view = member(db, art.id, token)
    expect(view).toMatchObject({ role: 'member', title: 'Kerst', drawn: false, organiser: true, pick: null })
    expect(view.members).toEqual([{ id: art.id, name: 'Art', picture: null, you: true, organiser: true, hasList: true, waiting: false }])
    expect(listGroups(db, art.id)).toEqual([{ token, title: 'Kerst', members: 1, drawn: false, organiser: true }])
  })

  it('takes a list of the maker\'s own, or none, and never someone else\'s', () => {
    const { db, art, lists } = setup()
    const without = createGroup(db, art.id, 'Zonder', null).token
    expect(member(db, art.id, without)).toMatchObject({ list: null })
    expect(member(db, art.id, without).members[0]!.hasList).toBe(false)
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
    expect(member(db, lot.id, token).members.map(row => row.hasList)).toEqual([false, true])
    expect(member(db, art.id, token).list).toBeNull()
    addOwner(db, lists.lot, art.id)
    leaveList(db, lot.id, lists.lot)
    expect(member(db, art.id, token).members.map(row => row.hasList)).toEqual([false, false])
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

  it('happens once: with a name for everyone, nobody draws again, leaves or is taken out', () => {
    const { db, art, lot, mom, token } = full()
    drawNames(db, art.id, token)
    const before = draws(db, token)
    expect(codeOf(() => drawNames(db, art.id, token))).toBe('santa_drawn')
    expect(codeOf(() => leaveGroup(db, lot.id, token))).toBe('santa_drawn')
    expect(codeOf(() => removeMember(db, art.id, token, mom.id))).toBe('santa_drawn')
    expect(draws(db, token)).toEqual(before)
    expect(member(db, lot.id, token)).toMatchObject({ waits: null })
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
    expect(codeOf(() => leaveGroup(db, lot.id, token))).toBe('santa_drawn')
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
    expect(codeOf(() => leaveGroup(db, lars.id, token))).toBe('santa_drawn')
    expect(draws(db, token)).toEqual(after)
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
