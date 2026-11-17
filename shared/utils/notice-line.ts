import type { NoticeView } from '../schemas/list'
import type { Translate } from './wish-line'

/**
 * The sentence of a notice: who did what to which wish or list. A used link can have shared
 * several wishes; `more` picks the form that says how many besides the one named.
 */
export function noticeLine(notice: NoticeView, t: Translate): string {
  return t(`notice.${notice.kind}`, { actor: notice.actor, title: notice.title, n: notice.more }, notice.more)
}
