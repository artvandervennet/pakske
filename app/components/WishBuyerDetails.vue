<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'

// What an unfolded row shows to someone who doesn't own the wish: the text and the shop link,
// and for a buyer who is buying it, the notes, and a way to put it on a list of their own. A
// visitor who isn't logged in gets a way to log in that brings them back to this row. An owner
// gets WishEditor instead.
// `owners` is the list's owners. The notes are hidden from them and from the wish's other owners.
const props = defineProps<{ wish: WishView, token: string, owners: string[] }>()
const emit = defineEmits<{ changed: [], added: [list: { token: string, title: string }], removed: [] }>()

const { t } = useI18n()
const names = useNames()
const route = useRoute()
const localePath = useLocalePath()

const host = computed(() => hostOf(props.wish.url))

// Giving without your name. With a purchase, changing it saves at once; without one, the tick
// that follows takes it along (useBuyAnonymously).
const { isAnonymous, choose } = useBuyAnonymously()
const { parse } = useApiError()
const anonymousId = useId()
const anonymousBusy = ref(false)
const anonymousError = ref('')

async function onAnonymous(event: Event) {
  const input = event.target as HTMLInputElement
  const anonymous = input.checked
  if (props.wish.role !== 'buyer' || anonymousBusy.value) return
  choose(props.wish.id, anonymous)
  anonymousError.value = ''
  if (props.wish.mine === 0) return
  anonymousBusy.value = true
  try {
    await $fetch(`/api/lists/${props.token}/wishes/${props.wish.id}/purchase`, { method: 'PUT', body: { quantity: props.wish.mine, anonymous } })
    emit('changed')
  }
  catch (error) {
    choose(props.wish.id, !anonymous)
    input.checked = !anonymous
    anonymousError.value = parse(error).message
  }
  finally {
    anonymousBusy.value = false
  }
}
const hiddenFrom = computed(() => names([...props.owners, ...props.wish.sharedWith]))
const loginLink = computed(() => ({
  path: localePath('/login'),
  query: { next: `${route.path}#wish-${props.wish.id}` },
}))
</script>

<template>
  <div class="wish-details-body">
    <p v-if="wish.description" class="wish-text">{{ wish.description }}</p>
    <art-button v-if="wish.url && host" variant="secondary" size="s">
      <a :href="wish.url" target="_blank" rel="noopener noreferrer">{{ t('wish.viewOn', { host }) }}</a>
    </art-button>

    <template v-if="wish.role === 'buyer'">
      <p v-if="wish.removed" class="form-message">{{ t('wish.removedIntro', { names: names(owners) }, owners.length) }}</p>
      <h3 class="wish-subtitle">{{ t('purchase.title') }}</h3>
      <ul v-if="wish.purchases.length" class="people">
        <li v-for="(purchase, index) in wish.purchases" :key="index">
          <span>{{ purchase.mine ? (purchase.anonymous ? t('purchase.youAnonymous') : t('purchase.you')) : purchase.name ?? t('purchase.someone') }}</span>
          <span class="count">{{ purchase.quantity }}×</span>
        </li>
      </ul>
      <p v-else class="muted">{{ t('wish.nobody') }}</p>
      <div v-if="!wish.removed" class="anonymous-choice">
        <label class="switch">
          <input
            type="checkbox"
            :checked="isAnonymous(wish)"
            :aria-busy="anonymousBusy || undefined"
            :aria-describedby="`${anonymousId}-hint`"
            @change="onAnonymous"
          >
          {{ t('purchase.anonymous') }}
        </label>
        <p :id="`${anonymousId}-hint`" class="anonymous-hint">{{ t('purchase.anonymousHint') }}</p>
        <p v-if="anonymousError" class="inline-field-error" role="alert">{{ anonymousError }}</p>
      </div>
      <h3 class="wish-subtitle">{{ t('notes.title') }}</h3>
      <WishNotes :wish="wish" :token="token" :hidden-from="hiddenFrom" @changed="emit('changed')" />
      <AddToMyList v-if="!wish.removed" :wish="wish" :token="token" @added="list => emit('added', list)" @removed="emit('removed')" />
    </template>

    <p v-else-if="wish.role === 'anon'" class="muted">
      {{ t('wish.anonHint') }}
      <NuxtLink :to="loginLink">{{ t('nav.login') }}</NuxtLink>
    </p>
  </div>
</template>
