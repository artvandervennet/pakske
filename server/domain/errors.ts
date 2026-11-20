export type DomainErrorCode
  = | 'not_found'
    | 'forbidden'
    | 'validation'
    | 'email_taken'
    | 'email_same'
    | 'registration_closed'
    | 'list_limit'
    | 'list_limit_ever'
    | 'wish_limit'
    | 'wish_limit_ever'
    | 'note_limit'
    | 'quantity_exceeded'
    | 'wish_removed'
    | 'list_shared'
    | 'last_owner'
    | 'invite_closed'
    | 'google_unverified'
    | 'google_email_taken'
    | 'google_taken'
    | 'password_needed'
    | 'wrong_password'
    | 'reauth_needed'
    | 'friend_limit'
    | 'request_limit'
    | 'not_friends'
    | 'santa_drawn'
    | 'santa_too_few'
    | 'santa_full'
    | 'santa_limit'

/** A rule of Pakske said no. The API turns the code into a status and the client into a sentence. */
export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode) {
    super(code)
    this.name = 'DomainError'
  }
}
