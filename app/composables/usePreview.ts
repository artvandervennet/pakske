/**
 * What a chat app shows of a link to this page: a title and one sentence, with the site's
 * picture (useSiteHead). For the pages that are passed on. iMessage shows the title alone, so
 * it has to say what the link is without the sentence.
 *
 * Whoever fetches a link for a chat app isn't logged in, so on a page that needs a login this
 * may only hold what the address itself says. `path` is the link that was sent, for a page the
 * visitor was sent on from.
 */
export function usePreview(preview: () => { title: string, description: string, path?: string | null }) {
  const origin = useSiteOrigin()
  const route = useRoute()
  useSeoMeta({
    description: () => preview().description,
    ogTitle: () => preview().title,
    ogDescription: () => preview().description,
    ogUrl: () => origin + (preview().path ?? route.path),
  })
}
