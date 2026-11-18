<script setup lang="ts">
// Light, dark or what the device says: Gesso's <art-scheme remember> as three choices on view
// instead of one button that cycles. It does what that element does, so the two stay in step:
// the choice goes on <html data-scheme>, is kept in this browser under 'gesso-scheme' (which
// the script in nuxt.config.ts reads before the stylesheets apply), and a `gesso:schemechange`
// event tells whoever else shows it.
// The server can't know what this browser holds, so it marks no choice and takes none: the
// buttons wake up once the page is alive.
// `labelledby` and `describedby` are the ids of the heading and the explanation beside it.
defineProps<{ labelledby: string, describedby?: string }>()

const { t } = useI18n()

const KEY = 'gesso-scheme'
const SCHEMES = ['auto', 'light', 'dark'] as const
type Scheme = typeof SCHEMES[number]
const LABEL: Record<Scheme, string> = { auto: 'settings.schemeAuto', light: 'settings.schemeLight', dark: 'settings.schemeDark' }

const name = useId()
const current = ref<Scheme | null>(null)

/** What the page shows now. A page that says nothing is light, as in Gesso. */
function shown(): Scheme {
  const scheme = document.documentElement.dataset.scheme
  return SCHEMES.find(known => known === scheme) ?? 'light'
}

function sync() {
  current.value = shown()
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
</script>

<template>
  <div class="list-chooser-options" role="radiogroup" :aria-labelledby="labelledby" :aria-describedby="describedby">
    <label v-for="scheme in SCHEMES" :key="scheme" class="list-chooser-option">
      <input type="radio" :name="name" :value="scheme" :checked="current === scheme" :disabled="current === null" @change="choose(scheme)">
      <span>{{ t(LABEL[scheme]) }}</span>
    </label>
  </div>
</template>
