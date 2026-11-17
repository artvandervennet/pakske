<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const { user } = useUserSession()

useHead({ title: () => t('form.editTitle') })

// The owner's own list, in the owner's view: wishes only.
const { list } = await useList(() => user.value?.username ?? '')
const item = list.value.items.find(candidate => String(candidate.id) === String(route.params.id))
if (!item) throw createError({ statusCode: 404, fatal: true })
</script>

<template>
  <div v-if="user">
    <PageHead :title="t('form.editTitle')">
      <template #crumb>
        <NuxtLink class="crumb" :to="localePath(`/u/${user.username}/${item.id}`)">{{ t('item.back') }}</NuxtLink>
      </template>
    </PageHead>
    <section class="band wide" data-paint="1">
      <div class="inner">
        <ItemForm :item="item" :username="user.username" />
      </div>
    </section>
  </div>
</template>
