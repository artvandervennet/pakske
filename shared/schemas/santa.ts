import type { MyLists } from './list'

// What the Secret Santa pages get. Nothing in these says whose name anyone but the asker drew.

/** How many people a draw needs. With fewer, everyone would know who drew them. */
export const SANTA_MIN_MEMBERS = 3

/** A group the person is in, as a row on the Secret Santa page and the home page. */
export interface SantaGroupRow {
  token: string
  title: string
  members: number
  drawn: boolean
  /** The person runs it: they joined first of the members it has now. */
  organiser: boolean
}

export interface SantaMember {
  id: number
  name: string
  /** Their profile picture, when they are a friend of the asker: nobody else is shown one. */
  picture: string | null
  you: boolean
  organiser: boolean
  /** They put a list in, which is still theirs. Which list is for whoever draws them. */
  hasList: boolean
  /** The names are drawn and they are not part of it: the draw waits to be done again. */
  waiting: boolean
}

/** A group as someone who isn't in it gets it: enough to decide whether to join. */
export interface SantaGuestView {
  role: 'guest'
  title: string
  /** The display name of whoever runs it. */
  organiser: string
  members: number
  /**
   * `drawn` once the names are drawn: joining is still possible, without a name until they are
   * drawn again. `full` at the most a group holds, which can't be joined.
   */
  state: 'open' | 'drawn' | 'full'
  /** The opener's own lists, to choose which one goes in. */
  mine: MyLists
}

/** A group as one of its members gets it. */
export interface SantaMemberView {
  role: 'member'
  token: string
  title: string
  drawn: boolean
  /** The asker runs it. */
  organiser: boolean
  /** In the order they joined. */
  members: SantaMember[]
  /** The asker's own lists, oldest first, and which of them they put in. */
  lists: { token: string, title: string }[]
  list: string | null
  /**
   * Whose name the asker drew, with the list that person put in. Null before the draw, and
   * after it while `waits` says why.
   */
  pick: { id: number, name: string, picture: string | null, list: { token: string, title: string } | null } | null
  /**
   * Why the asker has no name after the draw: `late` when they joined after it, `gone` when the
   * person they drew no longer has an account and nobody was left to pass on. Null otherwise.
   */
  waits: 'late' | 'gone' | null
}

export type SantaView = SantaGuestView | SantaMemberView
