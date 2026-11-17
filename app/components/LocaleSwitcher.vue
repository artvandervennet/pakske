<script setup lang="ts">
const { t, locale, locales } = useI18n()
const switchLocalePath = useSwitchLocalePath()
</script>

<template>
  <nav :aria-label="t('nav.language')">
    <template v-for="l in locales" :key="l.code">
      <strong v-if="l.code === locale" aria-current="true">{{ l.name }}</strong>
      <NuxtLink v-else :to="switchLocalePath(l.code)" :lang="l.language" :hreflang="l.language">{{ l.name }}</NuxtLink>
    </template>
  </nav>
</template>
