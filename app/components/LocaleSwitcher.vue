<script setup lang="ts">
const { t, locale, locales } = useI18n()
const switchLocalePath = useSwitchLocalePath()

// Without the part after #: the server never gets it, so a link with it (`/l/…#wish-12`)
// would differ between the server's HTML and the browser's, and Vue reports a mismatch.
const pathIn = (code: typeof locale.value) => switchLocalePath(code).split('#')[0]
</script>

<template>
  <nav :aria-label="t('nav.language')">
    <template v-for="l in locales" :key="l.code">
      <strong v-if="l.code === locale" aria-current="true">{{ l.name }}</strong>
      <NuxtLink v-else :to="pathIn(l.code)" :lang="l.language" :hreflang="l.language">{{ l.name }}</NuxtLink>
    </template>
  </nav>
</template>
