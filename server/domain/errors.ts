export type DomainErrorCode
  = | 'not_found'
    | 'forbidden'
    | 'validation'
    | 'email_taken'
    | 'username_taken'
    | 'registration_closed'
    | 'item_limit'
    | 'quantity_exceeded'
    | 'item_removed'

/** A rule of the wishlist said no. The API turns the code into a status and the client into a sentence. */
export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode) {
    super(code)
    this.name = 'DomainError'
  }
}
