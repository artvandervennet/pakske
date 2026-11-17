<script setup lang="ts">
const { t } = useI18n()
const localeHead = useLocaleHead({ seo: false })

useHead(() => ({
  htmlAttrs: { lang: localeHead.value.htmlAttrs?.lang },
  titleTemplate: title => (title ? `${title} · ${t('site.name')}` : t('site.name')),
}))
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
