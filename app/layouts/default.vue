<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <a class="skip-link" href="#main">{{ t('site.skip') }}</a>
  <AppHeader />
  <main id="main" tabindex="-1">
    <slot />
  </main>
  <AppFooter />
</template>
