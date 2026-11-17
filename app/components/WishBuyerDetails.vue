<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'

// What an unfolded row shows to someone who doesn't own the wish: the text and the shop link,
// and for a buyer who is buying it and the notes. A visitor who isn't logged in gets a way to
// log in that brings them back to this row. An owner gets WishEditor instead.
const props = defineProps<{ wish: WishView, token: string, owners: string, ownerCount: number }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const route = useRoute()
const localePath = useLocalePath()

const host = computed(() => hostOf(props.wish.url))
const loginLink = computed(() => ({
  path: localePath('/login'),
  query: { next: `${route.path}#wish-${props.wish.id}` },
}))
</script>

<template>
  <div class="wish-details-body">
    <p v-if="wish.description" class="wish-text">{{ wish.description }}</p>
    <art-button v-if="wish.url && host" variant="secondary" size="s">
      <a :href="wish.url" target="_blank" rel="noopener noreferrer">{{ t('item.viewOn', { host }) }}</a>
    </art-button>

    <template v-if="wish.role === 'buyer'">
      <p v-if="wish.removed" class="form-message">{{ t('wish.removedIntro', { names: owners }, ownerCount) }}</p>
      <h3 class="wish-subtitle">{{ t('purchase.title') }}</h3>
      <ul v-if="wish.purchases.length" class="people">
        <li v-for="(purchase, index) in wish.purchases" :key="index">
          <span>{{ purchase.mine ? t('purchase.you') : purchase.name }}</span>
          <span class="count">{{ purchase.quantity }}×</span>
        </li>
      </ul>
      <p v-else class="muted">{{ t('wish.nobody') }}</p>
      <h3 class="wish-subtitle">{{ t('notes.title') }}</h3>
      <WishNotes :wish="wish" :token="token" :owners="owners" @changed="emit('changed')" />
    </template>

    <p v-else-if="wish.role === 'anon'" class="muted">
      {{ t('wish.anonHint') }}
      <NuxtLink :to="loginLink">{{ t('nav.login') }}</NuxtLink>
    </p>
  </div>
</template>
