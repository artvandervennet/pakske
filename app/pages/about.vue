<script setup lang="ts">
// What Pakske is and what it does, for anyone, logged in or not. Only the footer links here.
// A band per subject, in Gesso's paints 1 to 8 in turn, built from an outline of sentences
// (shared/utils/about.ts).
const { t } = useI18n()
const localePath = useLocalePath()

useHead({ title: () => t('about.title') })
// In a search result and a chat app: what Pakske is, in the page's own first sentence.
usePreview(() => ({ title: t('about.title'), description: t('about.what.site') }))
</script>

<template>
  <div>
    <PageHead :title="t('about.title')" :lead="t('about.lead')" />
    <section
      v-for="(part, index) in aboutOutline"
      :key="part.id"
      class="band section"
      :data-paint="index % 8 + 1"
      :aria-labelledby="`about-${part.id}`"
    >
      <div class="inner">
        <div class="section-head">
          <h2 :id="`about-${part.id}`" class="section-title">{{ t(part.title) }}</h2>
        </div>
        <div class="section-body longform">
          <template v-for="(block, blockIndex) in part.blocks" :key="blockIndex">
            <p v-if="block.kind === 'text'">{{ t(block.key) }}</p>
            <p v-else-if="block.kind === 'link' && block.to.startsWith('/')"><NuxtLink :to="localePath(block.to)">{{ t(block.key) }}</NuxtLink></p>
            <p v-else-if="block.kind === 'link'"><a :href="block.to">{{ t(block.key) }}</a></p>
          </template>
        </div>
      </div>
    </section>
  </div>
</template>
