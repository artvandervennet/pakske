// What the friends pages get. Nothing in these is about anyone else's friends.

export interface RequestsView {
  /** Waiting for this person's answer, newest first. `via` is the list it was sent from, while that exists. */
  incoming: { id: string, fromId: number, from: string, via: string | null, fresh: boolean, createdAt: string }[]
  /** What this person asked and still sees: waiting or declined, with nothing to tell them apart. */
  outgoing: { id: string, toId: number, to: string }[]
}

export interface FriendView {
  id: number
  name: string
  /** Their profile picture, or null when they have none and the page draws one from the id. */
  picture: string | null
  /** Every live list of the asker's own that isn't this friend's too, with whether this friend finds it. */
  shows: { token: string, title: string, shown: boolean }[]
  /** The lists this friend shows the asker, without the ones the asker took off their page. */
  sees: { token: string, title: string }[]
}

export interface FriendsView {
  friends: FriendView[]
  requests: RequestsView
}

export interface FriendLinkView {
  /** The display name of whoever made the link. */
  from: string
  /** `closed` once it is used or past its time, `own` for its maker, `friends` for someone who is one already. */
  state: 'open' | 'own' | 'closed' | 'friends'
}
