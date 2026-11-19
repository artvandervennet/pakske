/**
 * How long ago something happened, the way a person would say it: "nu", "12 minuten geleden",
 * "gisteren", "3 dagen geleden". After a week it is the date, which says more than a count of
 * weeks. `now` is handed in, so the answer doesn't depend on when it is asked.
 */
export function ago(then: Date, now: Date, locale: string): string {
  const seconds = Math.min(0, Math.round((then.getTime() - now.getTime()) / 1000))
  const past = -seconds
  const words = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (past < 60) return words.format(0, 'second')
  if (past < 60 * 60) return words.format(Math.ceil(seconds / 60), 'minute')
  if (past < 24 * 60 * 60) return words.format(Math.ceil(seconds / (60 * 60)), 'hour')
  if (past < 7 * 24 * 60 * 60) return words.format(Math.ceil(seconds / (24 * 60 * 60)), 'day')
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(then)
}
