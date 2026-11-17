export type DomainErrorCode
  = | 'not_found'
    | 'forbidden'
    | 'validation'
    | 'email_taken'
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

/** A rule of the wishlist said no. The API turns the code into a status and the client into a sentence. */
export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode) {
    super(code)
    this.name = 'DomainError'
  }
}
