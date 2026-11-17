import { describe, expect, it } from 'vitest'
import type { NoticeKind, NoticeView } from '../shared/schemas/list'
import { noticeLine } from '../shared/utils/notice-line'
import type { Translate } from '../shared/utils/wish-line'

// Writes out the key and everything passed with it instead of a sentence, so a test can see
// which string a notice uses and with what, without depending on the locale files.
const t = ((key: string, arg: number | Record<string, unknown>, plural?: number) =>
  typeof arg === 'number'
    ? `[${key} ${arg}]`
    : `[${key} ${JSON.stringify(arg)}${plural === undefined ? '' : ` ${plural}`}]`) as Translate

function notice(kind: NoticeKind, extra: Partial<NoticeView> = {}): NoticeView {
  return {
    id: 'n1',
    kind,
    actor: 'Lotte',
    actorId: 2,
    title: 'Bordspel',
    more: 0,
    token: 'list-1',
    wishId: 7,
    canUndo: false,
    fresh: true,
    createdAt: '2026-11-17T10:00:00.000Z',
    ...extra,
  }
}

describe("a notice's sentence", () => {
  it.each(['wish_linked', 'wish_unlinked', 'joint_link_used', 'list_joined'] as const)(
    'uses the key of its own kind, %s, with who did it and the title',
    (kind) => {
      expect(noticeLine(notice(kind), t)).toBe(`[notice.${kind} {"actor":"Lotte","title":"Bordspel","n":0} 0]`)
    },
  )

  it('picks the form of a used link by how many more wishes it shared', () => {
    expect(noticeLine(notice('joint_link_used', { more: 1 }), t))
      .toBe('[notice.joint_link_used {"actor":"Lotte","title":"Bordspel","n":1} 1]')
    expect(noticeLine(notice('joint_link_used', { more: 4 }), t))
      .toBe('[notice.joint_link_used {"actor":"Lotte","title":"Bordspel","n":4} 4]')
  })

  it('names the actor and the title as they are in the notice, and nothing else', () => {
    const line = noticeLine(notice('wish_linked', { actor: 'Anne-Sophie', title: 'Lamp "Bol"', canUndo: true }), t)
    expect(line).toBe('[notice.wish_linked {"actor":"Anne-Sophie","title":"Lamp \\"Bol\\"","n":0} 0]')
  })
})
