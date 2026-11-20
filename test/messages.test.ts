import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { friendships, listMessages, listThreads, notices, users } from '../server/db/schema'
import { getListView } from '../server/domain/list-view'
import { deleteList, relinkList } from '../server/domain/lists'
import { deleteMessage, deleteThread, sendMessage, threadsFor } from '../server/domain/messages'
import { listNotices } from '../server/domain/notices'
import { setPurchase } from '../server/domain/purchases'
import { deleteUser } from '../server/domain/users'
import { rememberList } from '../server/domain/visits'
import { addList, addOwner, addUser, addWishTo, codeOf, makeDb } from './helpers'

function setup() {
  const db = makeDb()
  const art = addUser(db, 'art')
  const lotte = addUser(db, 'lotte')
  const mom = addUser(db, 'mom')
  const sis = addUser(db, 'sis')
  const token = addList(db, art.id)
  // Mom and Sis came by the link, as the list's route records it.
  rememberList(db, mom.id, token)
  rememberList(db, sis.id, token)
  return { db, art, lotte, mom, sis, token }
}

/** What a person reads on the list: per conversation, each message as who it says wrote it and its words. */
const read = (db: ReturnType<typeof makeDb>, userId: number, token: string) =>
  threadsFor(db, userId, token).map(thread => thread.messages.map(message =>
    `${message.mine ? 'me' : message.fromOwner ? message.owner : 'someone'}: ${message.body}`))

const noticesOf = (db: ReturnType<typeof makeDb>, userId: number) =>
  listNotices(db, userId).map(({ kind, actor, actorId, picture, title, token }) => ({ kind, actor, actorId, picture, title, token }))

describe('writing to the owners of a list', () => {
  it('lets someone who opened a list write to its owner, who reads it without a name', () => {
    const { db, art, mom, token } = setup()
    sendMessage(db, mom.id, token, 'Welke maat draag je?')
    expect(read(db, art.id, token)).toEqual([['someone: Welke maat draag je?']])
    expect(read(db, mom.id, token)).toEqual([['me: Welke maat draag je?']])
  })

  it('sends an owner nothing that says who wrote', () => {
    const { db, art, mom, token } = setup()
    // Friends, and Mom has a picture: it would come along if her account did.
    db.insert(friendships).values({ userLow: Math.min(art.id, mom.id), userHigh: Math.max(art.id, mom.id) }).run()
    db.update(users).set({ imageFile: 'mom.jpg' }).where(eq(users.id, mom.id)).run()
    sendMessage(db, mom.id, token, 'Welke maat draag je?')
    const sent = JSON.stringify({ threads: threadsFor(db, art.id, token), notices: listNotices(db, art.id) })
    expect(sent).not.toMatch(/Mom|mom\.jpg/)
    expect(sent).not.toMatch(new RegExp(`"(userId|actorId|id)":${mom.id}\\b`))
    expect(noticesOf(db, art.id)).toEqual([{ kind: 'list_message', actor: '', actorId: 0, picture: null, title: 'Kerst', token }])
    // The notice's row doesn't hold it either.
    expect(db.select({ actorId: notices.actorId }).from(notices).where(eq(notices.userId, art.id)).all()).toEqual([{ actorId: art.id }])
  })

  it('keeps each person in a conversation of their own', () => {
    const { db, art, mom, sis, token } = setup()
    sendMessage(db, mom.id, token, 'Welke maat?')
    sendMessage(db, sis.id, token, 'Heb je al een fiets?')
    sendMessage(db, mom.id, token, 'En welke kleur?')
    // An owner: every conversation, the one written in last first.
    expect(read(db, art.id, token)).toEqual([
      ['someone: Welke maat?', 'someone: En welke kleur?'],
      ['someone: Heb je al een fiets?'],
    ])
    expect(read(db, mom.id, token)).toEqual([['me: Welke maat?', 'me: En welke kleur?']])
    expect(read(db, sis.id, token)).toEqual([['me: Heb je al een fiets?']])
  })

  it('lets an owner answer in a conversation, with their name', () => {
    const { db, art, mom, sis, token } = setup()
    const { thread } = sendMessage(db, mom.id, token, 'Welke maat?')
    sendMessage(db, sis.id, token, 'Heb je al een fiets?')
    sendMessage(db, art.id, token, 'Medium.', thread)
    expect(read(db, mom.id, token)).toEqual([['me: Welke maat?', 'Art: Medium.']])
    expect(read(db, sis.id, token)).toEqual([['me: Heb je al een fiets?']])
    expect(read(db, art.id, token)[0]).toEqual(['someone: Welke maat?', 'me: Medium.'])
  })

  it('tells whoever wrote that an owner answered, with a way back to the list', () => {
    const { db, art, mom, token } = setup()
    const { thread } = sendMessage(db, mom.id, token, 'Welke maat?')
    sendMessage(db, art.id, token, 'Medium.', thread)
    expect(noticesOf(db, mom.id)).toEqual([{ kind: 'message_answered', actor: 'Art', actorId: art.id, picture: null, title: 'Kerst', token }])
  })

  it('keeps one notice per list, however many messages came', () => {
    const { db, art, mom, sis, token } = setup()
    const { thread } = sendMessage(db, mom.id, token, 'Een')
    sendMessage(db, sis.id, token, 'Twee')
    sendMessage(db, mom.id, token, 'Drie')
    expect(noticesOf(db, art.id)).toHaveLength(1)
    sendMessage(db, art.id, token, 'Ja', thread)
    sendMessage(db, art.id, token, 'En nog iets', thread)
    expect(noticesOf(db, mom.id)).toHaveLength(1)
  })

  it('tells every owner of a joint list, and no owner of another\'s answer', () => {
    const { db, art, lotte, mom, token } = setup()
    addOwner(db, token, lotte.id)
    const { thread } = sendMessage(db, mom.id, token, 'Wat willen jullie echt?')
    expect(noticesOf(db, art.id).map(notice => notice.kind)).toEqual(['list_message'])
    expect(noticesOf(db, lotte.id).map(notice => notice.kind)).toEqual(['list_message'])
    sendMessage(db, lotte.id, token, 'Een weekend weg.', thread)
    expect(noticesOf(db, art.id)).toHaveLength(1)
    expect(read(db, art.id, token)).toEqual([['someone: Wat willen jullie echt?', 'Lotte: Een weekend weg.']])
    expect(read(db, mom.id, token)).toEqual([['me: Wat willen jullie echt?', 'Lotte: Een weekend weg.']])
  })

  it('refuses an owner who names no conversation, and one that isn\'t on the list', () => {
    const { db, art, mom, token } = setup()
    const other = addList(db, art.id, 'Verjaardag')
    const { thread } = sendMessage(db, mom.id, token, 'Welke maat?')
    expect(codeOf(() => sendMessage(db, art.id, token, 'Hallo?'))).toBe('forbidden')
    expect(codeOf(() => sendMessage(db, art.id, other, 'Medium.', thread))).toBe('not_found')
    expect(codeOf(() => sendMessage(db, art.id, token, 'Medium.', crypto.randomUUID()))).toBe('not_found')
  })

  it('keeps someone who doesn\'t own the list in their own conversation, whatever they name', () => {
    const { db, art, mom, sis, token } = setup()
    const { thread } = sendMessage(db, mom.id, token, 'Welke maat?')
    sendMessage(db, sis.id, token, 'Ik lees mee', thread)
    expect(read(db, mom.id, token)).toEqual([['me: Welke maat?']])
    expect(read(db, art.id, token)).toHaveLength(2)
  })

  it('finds nothing for a list that is deleted or that never was', () => {
    const { db, art, mom, token } = setup()
    sendMessage(db, mom.id, token, 'Welke maat?')
    deleteList(db, art.id, token)
    expect(codeOf(() => sendMessage(db, mom.id, token, 'Nog iets'))).toBe('not_found')
    expect(codeOf(() => sendMessage(db, mom.id, 'no-such-token', 'Hallo'))).toBe('not_found')
    expect(threadsFor(db, mom.id, token)).toEqual([])
    expect(threadsFor(db, art.id, token)).toEqual([])
  })

  it('refuses a message on a list whose owners are gone: nobody would read it', () => {
    const { db, art, mom, token } = setup()
    deleteUser(db, art.id)
    expect(codeOf(() => sendMessage(db, mom.id, token, 'Hallo?'))).toBe('forbidden')
  })

  it('refuses the 201st message in a conversation', () => {
    const { db, art, mom, token } = setup()
    const { thread } = sendMessage(db, mom.id, token, 'Bericht 0')
    for (let i = 1; i < 200; i++) sendMessage(db, i % 2 ? art.id : mom.id, token, `Bericht ${i}`, i % 2 ? thread : undefined)
    expect(codeOf(() => sendMessage(db, mom.id, token, 'Te veel'))).toBe('message_limit')
    expect(codeOf(() => sendMessage(db, art.id, token, 'Te veel', thread))).toBe('message_limit')
  })
})

describe('deleting what was written', () => {
  it('lets the writer delete their own message, and nobody else', () => {
    const { db, art, mom, sis, token } = setup()
    const first = sendMessage(db, mom.id, token, 'Voor je broer, oeps')
    sendMessage(db, mom.id, token, 'Welke maat?')
    const answer = sendMessage(db, art.id, token, 'Medium.', first.thread)
    expect(codeOf(() => deleteMessage(db, art.id, first.id))).toBe('not_found')
    expect(codeOf(() => deleteMessage(db, sis.id, first.id))).toBe('not_found')
    expect(codeOf(() => deleteMessage(db, mom.id, answer.id))).toBe('not_found')
    expect(codeOf(() => deleteMessage(db, mom.id, crypto.randomUUID()))).toBe('not_found')
    deleteMessage(db, mom.id, first.id)
    expect(read(db, art.id, token)).toEqual([['someone: Welke maat?', 'me: Medium.']])
  })

  it('ends a conversation with its last message, so the next one reads as someone new', () => {
    const { db, art, mom, token } = setup()
    const first = sendMessage(db, mom.id, token, 'Oeps')
    deleteMessage(db, mom.id, first.id)
    expect(threadsFor(db, art.id, token)).toEqual([])
    expect(db.select().from(listThreads).all()).toEqual([])
    const again = sendMessage(db, mom.id, token, 'Welke maat?')
    expect(again.thread).not.toBe(first.thread)
  })

  it('lets an owner delete a whole conversation on their list, and only there', () => {
    const { db, art, lotte, mom, sis, token } = setup()
    const { thread } = sendMessage(db, mom.id, token, 'Iets onaardigs')
    sendMessage(db, sis.id, token, 'Welke maat?')
    const lottes = addList(db, lotte.id, 'Lotte')
    expect(codeOf(() => deleteThread(db, mom.id, token, thread))).toBe('not_found')
    expect(codeOf(() => deleteThread(db, lotte.id, token, thread))).toBe('not_found')
    expect(codeOf(() => deleteThread(db, lotte.id, lottes, thread))).toBe('not_found')
    deleteThread(db, art.id, token, thread)
    expect(read(db, art.id, token)).toEqual([['someone: Welke maat?']])
    expect(threadsFor(db, mom.id, token)).toEqual([])
    expect(db.select().from(listMessages).all()).toHaveLength(1)
    expect(codeOf(() => deleteThread(db, art.id, token, thread))).toBe('not_found')
  })
})

describe('what happens around a conversation', () => {
  it('keeps a conversation for the owner when whoever wrote deletes their account', () => {
    const { db, art, mom, sis, token } = setup()
    sendMessage(db, mom.id, token, 'Welke maat?')
    sendMessage(db, sis.id, token, 'Heb je al een fiets?')
    const before = threadsFor(db, art.id, token)
    deleteUser(db, mom.id)
    // The same to the owner as before: an account that goes takes no conversation along.
    expect(threadsFor(db, art.id, token)).toEqual(before)
    // An answer then reaches nobody, and says so to nobody.
    sendMessage(db, art.id, token, 'Medium.', before[1]!.id)
    expect(read(db, art.id, token)[0]).toEqual(['someone: Welke maat?', 'me: Medium.'])
  })

  it('keeps an owner\'s answer, without a name, when that owner deletes their account', () => {
    const { db, art, lotte, mom, token } = setup()
    addOwner(db, token, lotte.id)
    const { thread } = sendMessage(db, mom.id, token, 'Welke maat?')
    sendMessage(db, lotte.id, token, 'Medium.', thread)
    deleteUser(db, lotte.id)
    expect(threadsFor(db, mom.id, token)[0]!.messages[1]).toMatchObject({ fromOwner: true, owner: null, body: 'Medium.' })
    expect(read(db, art.id, token)).toHaveLength(1)
  })

  it('gives the notice about an answer no address once the list has a new link', () => {
    const { db, art, mom, token } = setup()
    const { thread } = sendMessage(db, mom.id, token, 'Welke maat?')
    const fresh = relinkList(db, art.id, token).token
    sendMessage(db, art.id, fresh, 'Medium.', thread)
    expect(noticesOf(db, mom.id)).toEqual([{ kind: 'message_answered', actor: 'Art', actorId: art.id, picture: null, title: 'Kerst', token: null }])
    // The old address no longer takes a message; with the new one the conversation goes on.
    expect(codeOf(() => sendMessage(db, mom.id, token, 'Dank je'))).toBe('not_found')
    rememberList(db, mom.id, fresh)
    expect(noticesOf(db, mom.id)[0]!.token).toBe(fresh)
    expect(read(db, mom.id, fresh)).toEqual([['me: Welke maat?', 'Art: Medium.']])
  })

  it('changes nothing an owner sees of their wishes', () => {
    const { db, art, mom, token } = setup()
    const wish = addWishTo(db, art.id, token, 'Boek')
    setPurchase(db, token, wish.id, mom.id, 1)
    const before = getListView(db, token, art.id)
    sendMessage(db, mom.id, token, 'Ik heb het boek al')
    expect(getListView(db, token, art.id)).toEqual(before)
  })

  it('never reads what anyone ticked or wrote to other buyers', () => {
    expect(readFileSync('server/domain/messages.ts', 'utf8')).not.toMatch(/purchases|notes/i)
  })
})
