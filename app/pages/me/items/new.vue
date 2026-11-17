<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { t } = useI18n()
const localePath = useLocalePath()
const { user } = useUserSession()

useHead({ title: () => t('form.newTitle') })
</script>

<template>
  <div v-if="user">
    <PageHead :title="t('form.newTitle')">
      <template #crumb>
        <NuxtLink class="crumb" :to="localePath(`/u/${user.username}`)">{{ t('item.back') }}</NuxtLink>
      </template>
    </PageHead>
    <section class="band wide" data-paint="1">
      <div class="inner">
        <ItemForm :username="user.username" />
      </div>
    </section>
  </div>
</template>
