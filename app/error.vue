<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const { t } = useI18n()
const localePath = useLocalePath()

const notFound = computed(() => props.error.statusCode === 404)
const title = computed(() => (notFound.value ? t('error.notFoundTitle') : t('error.otherTitle')))
// This page takes app.vue's place, so it sets the language and the site's name itself.
useSiteHead()
useHead({ title })
</script>

<template>
  <NuxtLayout>
    <PageHead :title="title" />
    <section class="band wide" data-paint="1">
      <div class="inner">
        <div class="empty">
          <art-splatter pigment="complement" :seed="String(error.statusCode)" />
          <p>{{ notFound ? t('error.notFoundBody') : t('error.otherBody') }}</p>
          <art-button>
            <a :href="localePath('/')">{{ t('error.home') }}</a>
          </art-button>
        </div>
      </div>
    </section>
  </NuxtLayout>
</template>
