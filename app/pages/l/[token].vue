<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'
import type { AskTickWarning } from '~/composables/useTickWarning'

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

// One warning dialog for every row an owner can tick.
const warning = useTemplateRef<{ ask: AskTickWarning }>('warning')
provideTickWarning(title => warning.value?.ask(title) ?? Promise.resolve(false))
const hasOwnWishes = computed(() => list.value.wishes.some(wish => wish.role === 'owner'))

// A tick on a wish that was deleted meanwhile refreshes the list, and the row usually goes
// with it, taking its message along. Then the message is said here instead.
const goneNotice = ref('')
async function onTickChanged(wish: WishView, reason?: 'gone') {
  goneNotice.value = ''
  await refresh()
  // The list follows the fetched data through a watcher, which runs after this resolves.
  await nextTick()
  if (reason === 'gone' && !list.value.wishes.some(other => other.id === wish.id)) {
    goneNotice.value = t('tick.goneFromList', { title: wish.title })
  }
}

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
          <p v-if="goneNotice" class="form-message" role="alert">{{ goneNotice }}</p>
          <ul v-if="wishes.length || canAdd" class="wish-list">
            <WishRow
              v-for="wish in wishes"
              :key="wish.id"
              :wish="wish"
              :token="list.token"
              :owners="owners"
              :owner-count="list.owners.length"
              :open="open.has(wish.id)"
              @toggle="toggle(wish.id)"
              @changed="refresh()"
            >
              <template v-if="wish.role !== 'anon'" #tick>
                <WishTick :wish="wish" :token="list.token" @changed="reason => onTickChanged(wish, reason)" />
              </template>
            </WishRow>
            <li v-if="canAdd" class="wish-add">
              <QuickAdd :label="t('list.add')" :pending="adding" :error="addError" @add="addWish" />
            </li>
          </ul>
        </div>
      </div>
    </section>

    <TickWarning v-if="hasOwnWishes" ref="warning" />
  </div>
</template>
