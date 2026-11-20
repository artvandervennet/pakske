import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { friendRequests } from '../server/db/schema'
import { exportAccount } from '../server/domain/export'
import { answerRequest, askFriend, setShownTo } from '../server/domain/friends'
import { sendMessage } from '../server/domain/messages'
import { addNote } from '../server/domain/notes'
import { setPurchase } from '../server/domain/purchases'
import { createGroup, drawNames, joinGroup } from '../server/domain/santa'
import { setPicture } from '../server/domain/users'
import { rememberList } from '../server/domain/visits'
import { setWishImage } from '../server/domain/wishes'
import { addList, addUser, addWishTo, codeOf, makeDb } from './helpers'

/**
 * Art's list with socks on it. Mom gets the socks without her name, wrote a note about them and
 * wrote to Art, who answered. Lotte is Art's friend and sees his list. Art asked Mom to be
 * friends and she declined. All three are in a Secret Santa whose names are drawn.
 */
function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lotte = addUser(db, 'lotte')
  const mom = addUser(db, 'mom')
  const token = addList(db, art.id, 'Kerst')
  const sokken = addWishTo(db, art.id, token, 'Sokken')
  setWishImage(db, art.id, token, sokken.id, 'socks.png')
  setPicture(db, art.id, 'art.jpg')

  rememberList(db, mom.id, token)
  setPurchase(db, token, sokken.id, mom.id, 1, true)
  addNote(db, token, sokken.id, mom.id, 'Maat 43.')
  const { thread } = sendMessage(db, mom.id, token, 'Welke kleur?')
  sendMessage(db, art.id, token, 'Blauw.', thread)

  const moms = addList(db, mom.id, 'Van Mom')
  rememberList(db, art.id, moms)
  rememberList(db, lotte.id, token)
  askFriend(db, lotte.id, token, art.id)
  const fromLotte = db.select().from(friendRequests).where(eq(friendRequests.fromUser, lotte.id)).get()!
  answerRequest(db, art.id, fromLotte.id, true)
  setShownTo(db, art.id, token, [lotte.id])
  askFriend(db, art.id, moms, mom.id)
  const fromArt = db.select().from(friendRequests).where(eq(friendRequests.fromUser, art.id)).get()!
  answerRequest(db, mom.id, fromArt.id, false)

  const group = createGroup(db, art.id, 'Familie', token).token
  joinGroup(db, lotte.id, group, null)
  joinGroup(db, mom.id, group, null)
  drawNames(db, art.id, group)
  return { db, art, lotte, mom, token }
}

describe('the copy of an account\'s data', () => {
  it('holds what the person put on the site', () => {
    const { db, art, token } = setup()
    const copy = exportAccount(db, art.id, new Date('2026-11-20T12:00:00Z'))
    expect(copy.madeAt).toBe('2026-11-20T12:00:00.000Z')
    expect(copy.account).toMatchObject({ name: 'Art', email: 'art@example.test', picture: '/uploads/art.jpg', googleLinked: false })
    expect(copy.lists).toMatchObject([{
      title: 'Kerst',
      link: `/l/${token}`,
      sharedWith: [],
      shownToFriends: ['Lotte'],
      wishes: [{ title: 'Sokken', picture: '/uploads/socks.png', quantity: 1 }],
    }])
    expect(copy.messages).toMatchObject([{ list: 'Kerst', asOwner: true, body: 'Blauw.' }])
    expect(copy.visitedLists).toMatchObject([{ list: 'Van Mom' }])
    expect(copy.friends).toMatchObject([{ name: 'Lotte' }])
    expect(copy.secretSanta).toMatchObject([{ group: 'Familie', list: 'Kerst' }])
    expect(['Lotte', 'Mom']).toContain(copy.secretSanta[0]!.drew)
  })

  it('holds what the person ticked and wrote on other people\'s lists', () => {
    const { db, mom } = setup()
    const copy = exportAccount(db, mom.id)
    expect(copy.giving).toMatchObject([{ wish: 'Sokken', quantity: 1, anonymous: true }])
    expect(copy.notes).toMatchObject([{ wish: 'Sokken', body: 'Maat 43.' }])
    expect(copy.messages).toMatchObject([{ list: 'Kerst', asOwner: false, body: 'Welke kleur?' }])
    expect(copy.friendRequests.received).toMatchObject([{ from: 'Art', declined: true }])
  })

  // The pages keep these from an owner, so the file must too.
  it('tells an owner nothing about who gives their wishes or who wrote to them', () => {
    const { db, art } = setup()
    const copy = exportAccount(db, art.id)
    const text = JSON.stringify(copy)
    expect(copy.giving).toEqual([])
    expect(copy.notes).toEqual([])
    expect(text).not.toContain('Maat 43.')
    expect(text).not.toContain('Welke kleur?')
  })

  it('doesn\'t say that a request the person sent was declined', () => {
    const { db, art } = setup()
    const copy = exportAccount(db, art.id)
    expect(copy.friendRequests.sent).toHaveLength(1)
    expect(Object.keys(copy.friendRequests.sent[0]!).sort()).toEqual(['sentAt', 'to'])
    expect(JSON.stringify(copy)).not.toMatch(/declin/i)
  })

  it('holds nobody else\'s email address', () => {
    const { db, art, lotte, mom } = setup()
    for (const [who, others] of [[art, ['lotte', 'mom']], [lotte, ['art', 'mom']], [mom, ['art', 'lotte']]] as const) {
      const text = JSON.stringify(exportAccount(db, who.id))
      for (const other of others) expect(text).not.toContain(`${other}@example.test`)
    }
  })

  it('is "not found" for an account that isn\'t there', () => {
    expect(codeOf(() => exportAccount(makeDb(), 1))).toBe('not_found')
  })
})
