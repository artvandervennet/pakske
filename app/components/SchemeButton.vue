<script setup lang="ts">
// Light, dark or what the device says, for the footer, so someone who isn't logged in can
// choose too: one button that says the current choice and moves on to the next when pressed.
// It is Gesso's <art-scheme> in the page's language: that element only has English words. It
// looks the same (a dab of paint: hollow for light, full for dark, half for the system) and
// keeps the choice the same way (useScheme), so the three choices in Settings follow it.
const { t } = useI18n()
const { current, choose } = useScheme()

const next = computed(() => SCHEMES[(SCHEMES.indexOf(current.value ?? 'auto') + 1) % SCHEMES.length]!)
const name = computed(() => (current.value ? t(SCHEME_LABEL[current.value]) : t('settings.appearanceTitle')))
const label = computed(() => current.value
  ? t('settings.schemeNext', { now: t(SCHEME_LABEL[current.value]), next: t(SCHEME_LABEL[next.value]) })
  : undefined)
</script>

<template>
  <button type="button" class="scheme-button" :data-scheme="current ?? undefined" :disabled="current === null" :aria-label="label" @click="choose(next)">
    <span class="scheme-dab" aria-hidden="true" />
    <span>{{ name }}</span>
  </button>
</template>
