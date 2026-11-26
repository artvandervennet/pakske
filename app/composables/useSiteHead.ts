// The page's language on <html>, the site's name after every page title, what a chat app
// shows of a link to the site, and what search engines may do with the page. app.vue and
// error.vue both call it: the error page is rendered instead of app.vue, and would otherwise
// have none of it. An error page is never indexed, whatever its address.
export function useSiteHead(options: { error?: boolean } = {}) {
  const { t, locale, locales } = useI18n()
  const route = useRoute()
  const origin = useSiteOrigin()
  // "nl-BE" or "en-GB", from the list of languages in nuxt.config.ts.
  const lang = computed(() => locales.value.find(known => known.code === locale.value)?.language ?? locale.value)
  // The pages about the site itself may be indexed, nothing else (shared/utils/seo.ts); the
  // server says the same in X-Robots-Tag.
  const indexed = computed(() => (options.error ? null : indexedPage(route.path)))

  useHead(() => {
    const page = indexed.value
    const prefix = SITE_LANGUAGES.find(language => language.code === locale.value)?.prefix ?? ''
    const others = page ? alternates(origin, page) : []
    return {
      htmlAttrs: { lang: lang.value },
      titleTemplate: title => (title ? `${title} - ${t('site.name')}` : t('site.name')),
      meta: [{ name: 'robots', content: page ? 'index, follow, max-image-preview:large' : 'noindex, nofollow' }],
      // One address per page for search engines, and the same page in the other language.
      link: page
        ? [
            { rel: 'canonical', href: origin + pathIn(prefix, page) },
            ...others.map(other => ({ rel: 'alternate' as const, hreflang: other.language, href: other.href })),
            { rel: 'alternate' as const, hreflang: 'x-default', href: others[0]!.href },
          ]
        : [],
    }
  })

  // WhatsApp, iMessage, Signal and the like fetch a link when someone sends it and show a
  // picture, a title and a sentence with the message. Every page gets the site's own; a page
  // that is itself passed on says what it is with usePreview. The picture is the hero of the
  // home page (scripts/preview-image.html). The apps want whole addresses, not paths.
  useSeoMeta({
    description: () => t('home.lead'),
    ogType: 'website',
    ogSiteName: () => t('site.name'),
    ogLocale: () => lang.value.replace('-', '_'),
    ogUrl: () => origin + route.path,
    ogTitle: () => t('preview.title'),
    ogDescription: () => t('home.lead'),
    ogImage: () => [{ url: `${origin}/preview.png`, type: 'image/png' as const, width: 1200, height: 630, alt: t('preview.image') }],
    // The wide picture above the title, on the sites that also know a small square one.
    twitterCard: 'summary_large_image',
  })
}

/**
 * The site's address as the visitor typed it, such as "https://pakske.example". Behind a proxy
 * of ours (NUXT_TRUST_PROXY=true) the name is the one the proxy was asked for.
 */
export function useSiteOrigin(): string {
  const forwarded = import.meta.server && useRuntimeConfig().trustProxy === true
  return useRequestURL({ xForwardedHost: forwarded }).origin
}
