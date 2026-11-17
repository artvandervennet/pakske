<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()
const { amountLabel } = useItemStatus()

const username = computed(() => String(route.params.username))
const { list, refresh } = await useList(username)

const found = computed(() => list.value.items.find(item => String(item.id) === String(route.params.itemId)))
if (!found.value) throw createError({ statusCode: 404, fatal: true })
// After a refresh the wish can be gone (a buyer removed the last purchase on a deleted wish).
const item = computed(() => found.value ?? null)
watch(item, async (value) => {
  if (!value) await navigateTo(listPath.value)
})

const owner = computed(() => list.value.owner)
const buyerItem = computed(() => (item.value && isBuyerItem(item.value) ? item.value : null))
const listPath = computed(() => localePath(`/u/${owner.value.username}`))

useHead({ title: () => item.value?.title ?? '' })

const host = computed(() => {
  try {
    return item.value?.url ? new URL(item.value.url).host.replace(/^www\./, '') : null
  }
  catch {
    return null
  }
})

// Deleting asks first, in a native dialog. The safe button has the focus when it opens.
const dialog = ref<HTMLDialogElement>()
const deleteError = ref('')

async function onDialogClose() {
  const choice = dialog.value?.returnValue
  if (dialog.value) dialog.value.returnValue = ''
  if (choice !== 'delete' || !item.value) return
  try {
    await $fetch(`/api/me/items/${item.value.id}`, { method: 'DELETE' })
    await navigateTo(listPath.value)
  }
  catch (error) {
    deleteError.value = parse(error).message
  }
}
</script>

<template>
  <div v-if="item">
    <PageHead :title="item.title">
      <template #crumb>
        <NuxtLink class="crumb" :to="listPath">{{ t('item.back') }}</NuxtLink>
      </template>
      <template v-if="list.viewer === 'owner'" #actions>
        <art-button>
          <NuxtLink :to="localePath(`/me/items/${item.id}`)">{{ t('item.edit') }}</NuxtLink>
        </art-button>
        <art-button variant="secondary">
          <button type="button" @click="dialog?.showModal()">{{ t('item.delete') }}</button>
        </art-button>
      </template>
    </PageHead>

    <section class="band wide" data-paint="1">
      <div class="inner">
        <p v-if="deleteError" class="form-message" role="alert">{{ deleteError }}</p>
        <div class="wish" :class="{ 'has-image': item.image }">
          <img v-if="item.image" class="wish-image" :src="item.image" alt="" width="800" height="600">
          <div class="wish-body">
            <div class="tapes">
              <art-tape v-if="buyerItem?.removed" pigment="complement">{{ t('item.removed') }}</art-tape>
              <art-tape v-if="amountLabel(item)">{{ amountLabel(item) }}</art-tape>
            </div>
            <p v-if="item.description" class="longform wish-text">{{ item.description }}</p>
            <art-button v-if="item.url && host" variant="secondary">
              <a :href="item.url" target="_blank" rel="noopener noreferrer">{{ t('item.viewOn', { host }) }}</a>
            </art-button>
            <p v-if="list.viewer === 'owner'" class="muted">{{ t('list.ownerHint') }}</p>
            <p v-else-if="list.viewer === 'anon'" class="muted">
              {{ t('list.anonHint') }}
              <NuxtLink :to="{ path: localePath('/login'), query: { next: route.fullPath } }">{{ t('nav.login') }}</NuxtLink>
            </p>
          </div>
        </div>
      </div>
    </section>

    <template v-if="buyerItem">
      <section class="band section" data-paint="2" aria-labelledby="buyers-title">
        <div class="inner">
          <div class="section-head">
            <h2 id="buyers-title" class="section-title">{{ t('purchase.title') }}</h2>
            <p class="intro">{{ t('list.buyerHint', { name: owner.displayName }) }}</p>
          </div>
          <div class="section-body">
            <PurchasePanel :item="buyerItem" :owner-name="owner.displayName" @changed="refresh()" />
          </div>
        </div>
      </section>

      <section class="band section" data-paint="3" aria-labelledby="notes-title">
        <div class="inner">
          <div class="section-head">
            <h2 id="notes-title" class="section-title">{{ t('notes.title') }}</h2>
            <p class="intro">{{ t('notes.hint', { name: owner.displayName }) }}</p>
          </div>
          <div class="section-body">
            <ItemNotes :item="buyerItem" @changed="refresh()" />
          </div>
        </div>
      </section>
    </template>

    <dialog v-if="list.viewer === 'owner'" ref="dialog" class="dialog" aria-labelledby="delete-title" @close="onDialogClose">
      <h2 id="delete-title">{{ t('item.deleteTitle', { title: item.title }) }}</h2>
      <p>{{ t('item.deleteBody') }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('item.cancel') }}</button>
        </art-button>
        <art-button>
          <button value="delete">{{ t('item.deleteConfirm') }}</button>
        </art-button>
      </form>
    </dialog>
  </div>
</template>
