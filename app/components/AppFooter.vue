<script setup lang="ts">
// The signature only ever gets fixed text: art-signature writes its text into innerHTML.
const year = new Date().getFullYear()

const { t } = useI18n()
const localePath = useLocalePath()
</script>

<template>
  <footer class="band page-footer" data-paint="deep">
    <div class="inner">
      <LocaleSwitcher />
      <nav :aria-label="t('footer.label')">
        <NuxtLink :to="localePath('/privacy')">{{ t('footer.privacy') }}</NuxtLink>
        <NuxtLink :to="localePath('/terms')">{{ t('footer.terms') }}</NuxtLink>
      </nav>
      <SchemeButton />
      <art-signature :year="year">Art Van der Vennet</art-signature>
    </div>
  </footer>
</template>
