<script setup lang="ts">
import type { LegalSection } from '#shared/utils/legal'

// The privacy page and the terms: a title band and one column of text, built from an outline of
// sentences (shared/utils/legal.ts). `params` fills in who runs the site where a sentence says so.
const props = defineProps<{ name: 'privacy' | 'terms', sections: LegalSection[], params: Record<string, string> }>()

const { t } = useI18n()
const localePath = useLocalePath()

useHead({ title: () => t(`${props.name}.title`) })
</script>

<template>
  <div>
    <PageHead :title="t(`${name}.title`)" :lead="t(`${name}.lead`)" />
    <div class="band wide" data-paint="1">
      <div class="inner">
        <article class="legal">
          <p class="legal-updated">{{ t(`${name}.updated`) }}</p>
          <section v-for="section in sections" :key="section.id" :aria-labelledby="`${name}-${section.id}`">
            <h2 :id="`${name}-${section.id}`">{{ t(section.title) }}</h2>
            <template v-for="(block, index) in section.blocks" :key="index">
              <p v-if="block.kind === 'text'">{{ t(block.key, params) }}</p>
              <ul v-else-if="block.kind === 'list'">
                <li v-for="key in block.keys" :key="key">{{ t(key, params) }}</li>
              </ul>
              <p v-else-if="block.kind === 'mail'"><a :href="`mailto:${block.address}`">{{ block.address }}</a></p>
              <p v-else-if="block.to.startsWith('/')"><NuxtLink :to="localePath(block.to)">{{ t(block.key) }}</NuxtLink></p>
              <p v-else><a :href="block.to">{{ t(block.key) }}</a></p>
            </template>
          </section>
        </article>
      </div>
    </div>
  </div>
</template>
