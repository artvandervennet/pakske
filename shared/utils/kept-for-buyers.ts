// A wish that left its list stays there for whoever bought it, so they can see it went and take
// their purchase back. Not for good: after these days it is gone for them too, and the list is
// a clean page again for the next birthday.

export const KEPT_FOR_BUYERS_DAYS = 30

/**
 * When a wish stopped being on a list: taken off it, deleted, or its list deleted, whichever came
 * first. null while it is still on it.
 */
export function leftListAt(removedAt: Date | null, wishDeletedAt: Date | null, listDeletedAt: Date | null): Date | null {
  const moments = [removedAt, wishDeletedAt, listDeletedAt].flatMap(moment => moment ? [moment.getTime()] : [])
  return moments.length ? new Date(Math.min(...moments)) : null
}

/** Whether a wish that left its list then is still there for whoever bought it. */
export function keptForBuyers(leftAt: Date, now: Date): boolean {
  return now.getTime() - leftAt.getTime() < KEPT_FOR_BUYERS_DAYS * 24 * 60 * 60 * 1000
}
