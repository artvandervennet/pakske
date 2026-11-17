declare module '#auth-utils' {
  interface User {
    id: number
    displayName: string
    // When the account was made, in epoch milliseconds: with the id, it tells a cookie for this
    // account from one for an account that had the same id before (sessionBelongsTo). Missing
    // in cookies from before it was added.
    createdAt?: number
  }
}

export {}
