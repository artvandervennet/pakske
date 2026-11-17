<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'

const route = useRoute()
const { t, locale } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

const token = computed(() => String(route.params.token))
const { list, refresh } = await useListView(token)

useHead({ title: () => list.value.title })

const owners = computed(() =>
  new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(list.value.owners),
)
// Removed wishes only reach buyers, who still need them to sort out what they bought. They
// go last, below everything that is still wanted.
const wishes = computed(() => {
  const isRemoved = (wish: WishView) => wish.role === 'buyer' && wish.removed
  return [...list.value.wishes.filter(wish => !isRemoved(wish)), ...list.value.wishes.filter(isRemoved)]
})
const canAdd = computed(() => list.value.viewerOwnsList && !list.value.deleted)

const open = reactive(new Set<number>())
function toggle(id: number) {
  if (open.has(id)) open.delete(id)
  else open.add(id)
}

// A link to one wish (`/l/<token>#wish-12`, also where logging in returns to) opens that row.
// The server never sees the part after #, so this waits for the browser.
onMounted(async () => {
  const id = Number(/^#wish-(\d+)$/.exec(location.hash)?.[1])
  if (!list.value.wishes.some(wish => wish.id === id)) return
  open.add(id)
  await nextTick()
  document.getElementById(`wish-${id}`)?.scrollIntoView({ block: 'start' })
})

const adding = ref(false)
const addError = ref('')

async function addWish(title: string) {
  adding.value = true
  addError.value = ''
  try {
    await $fetch(`/api/lists/${token.value}/wishes`, { method: 'POST', body: { title } })
    // The field stays busy until the new row is there, so it doesn't empty before it shows.
    await refresh()
  }
  catch (error) {
    const parsed = parse(error)
    addError.value = parsed.fields.title ?? parsed.message
  }
  finally {
    adding.value = false
  }
}
</script>

<template>
  <div>
    <PageHead :title="list.title" :lead="list.viewerOwnsList ? null : t('list.owners', { names: owners })">
      <template #actions>
        <ShareButton :path="localePath(`/l/${list.token}`)" />
      </template>
    </PageHead>

    <section class="band section" data-paint="1" aria-labelledby="wishes-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="wishes-title" class="section-title">{{ t('list.wishes') }}</h2>
        </div>
        <div class="section-body">
          <p v-if="list.deleted" class="form-message">{{ t('list.deleted', { names: owners }, list.owners.length) }}</p>
          <p v-else-if="!wishes.length && !canAdd" class="muted">{{ t('list.empty') }}</p>
          <ul v-if="wishes.length || canAdd" class="wish-list">
            <WishRow
              v-for="wish in wishes"
              :key="wish.id"
              :wish="wish"
              :token="list.token"
              :owners="owners"
              :open="open.has(wish.id)"
              @toggle="toggle(wish.id)"
              @changed="refresh()"
            />
            <li v-if="canAdd" class="wish-add">
              <QuickAdd :label="t('list.add')" :pending="adding" :error="addError" @add="addWish" />
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>
