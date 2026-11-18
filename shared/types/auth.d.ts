declare module '#auth-utils' {
  interface User {
    id: number
    displayName: string
    // "Standaard anoniem geven" from Settings, so a tick knows how to start. Missing in cookies
    // from before it was added, which reads as off.
    anonymousDefault?: boolean
    // When the account was made, in epoch milliseconds: with the id, it tells a cookie for this
    // account from one for an account that had the same id before (sessionBelongsTo). Missing
    // in cookies from before it was added.
    createdAt?: number
  }

  // Server-only: never sent to the browser.
  interface SecureSessionData {
    // Firebase's token for this login, for what Settings asks of Firebase on the person's behalf
    // (linking Google, which ways they can log in). Missing in cookies from before Firebase.
    firebaseRefreshToken?: string
  }
}

export {}
