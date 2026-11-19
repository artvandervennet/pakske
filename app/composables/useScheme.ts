// Light, dark or what the device says, kept the way Gesso's <art-scheme remember> keeps it, so
// every switch on the page stays in step: the choice goes on <html data-scheme>, is kept in
// this browser under 'gesso-scheme' (which the script in nuxt.config.ts reads before the
// stylesheets apply), and a `gesso:schemechange` event tells whoever else shows it.
// The server can't know what this browser holds, so `current` is null until the page is alive.
const KEY = 'gesso-scheme'
export const SCHEMES = ['auto', 'light', 'dark'] as const
export type Scheme = typeof SCHEMES[number]
export const SCHEME_LABEL: Record<Scheme, string> = { auto: 'settings.schemeAuto', light: 'settings.schemeLight', dark: 'settings.schemeDark' }

export function useScheme() {
  const current = ref<Scheme | null>(null)

  /** What the page shows now. A page that says nothing is light, as in Gesso. */
  function sync() {
    const scheme = document.documentElement.dataset.scheme
    current.value = SCHEMES.find(known => known === scheme) ?? 'light'
  }

  onMounted(() => {
    sync()
    document.addEventListener('gesso:schemechange', sync)
  })
  onBeforeUnmount(() => document.removeEventListener('gesso:schemechange', sync))

  function choose(scheme: Scheme) {
    document.documentElement.dataset.scheme = scheme
    try {
      localStorage.setItem(KEY, scheme)
    }
    catch { /* A browser that keeps nothing: the choice lasts as long as this page. */ }
    document.dispatchEvent(new CustomEvent('gesso:schemechange', { detail: { scheme } }))
  }

  return { current, choose }
}
