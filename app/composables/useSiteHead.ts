// The page's language on <html>, and the site's name after every page title. app.vue and
// error.vue both call it: the error page is rendered instead of app.vue, and would otherwise
// have neither.
export function useSiteHead() {
  const { t, locale, locales } = useI18n()
  // "nl-BE" or "en-GB", from the list of languages in nuxt.config.ts.
  const lang = computed(() => locales.value.find(known => known.code === locale.value)?.language ?? locale.value)

  useHead(() => ({
    htmlAttrs: { lang: lang.value },
    titleTemplate: title => (title ? `${title} · ${t('site.name')}` : t('site.name')),
  }))
}
