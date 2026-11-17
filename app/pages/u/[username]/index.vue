<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()

const username = computed(() => String(route.params.username))
const { list } = await useList(username)

const owner = computed(() => list.value.owner)
const title = computed(() => (list.value.viewer === 'owner' ? t('list.yours') : t('list.title', { name: owner.value.displayName })))
useHead({ title })

// Buyers also get the wishes the owner deleted after someone bought them.
const live = computed(() => list.value.items.filter(item => !isBuyerItem(item) || !item.removed))
const removed = computed(() => list.value.items.filter(item => isBuyerItem(item) && item.removed))

const hint = computed(() => {
  if (list.value.viewer === 'owner') return t('list.ownerHint')
  if (list.value.viewer === 'buyer') return t('list.buyerHint', { name: owner.value.displayName })
  return t('list.anonHint')
})
</script>

<template>
  <div>
    <PageHead :title="title" :lead="owner.listIntro">
      <template v-if="list.viewer === 'owner'" #actions>
        <art-button>
          <NuxtLink :to="localePath('/me/items/new')">{{ t('list.add') }}</NuxtLink>
        </art-button>
      </template>
      <template v-else-if="list.viewer === 'anon'" #actions>
        <art-button>
          <NuxtLink :to="{ path: localePath('/login'), query: { next: route.fullPath } }">{{ t('nav.login') }}</NuxtLink>
        </art-button>
      </template>
    </PageHead>

    <section class="band section" data-paint="1" aria-labelledby="wishes-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="wishes-title" class="section-title">{{ t('list.wishesTitle') }}</h2>
          <p class="intro">{{ hint }}</p>
        </div>
        <div class="section-body">
          <ul v-if="live.length" class="card-grid">
            <li v-for="item in live" :key="`${item.id}-${item.updatedAt}`">
              <ItemCard :item="item" :username="owner.username" />
            </li>
          </ul>
          <div v-else class="empty">
            <art-splatter pigment="complement" :seed="`empty-${owner.username}`" />
            <p>{{ list.viewer === 'owner' ? t('list.emptyOwner') : t('list.emptyOther', { name: owner.displayName }) }}</p>
            <art-button v-if="list.viewer === 'owner'">
              <NuxtLink :to="localePath('/me/items/new')">{{ t('list.add') }}</NuxtLink>
            </art-button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="removed.length" class="band section" data-paint="2" aria-labelledby="removed-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="removed-title" class="section-title">{{ t('list.removedTitle') }}</h2>
          <p class="intro">{{ t('list.removedIntro', { name: owner.displayName }) }}</p>
        </div>
        <div class="section-body">
          <ul class="card-grid">
            <li v-for="item in removed" :key="item.id">
              <ItemCard :item="item" :username="owner.username" />
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>
