<script setup lang="ts">
// Light, dark or what the device says: Gesso's <art-scheme remember> as three choices on view
// instead of one button that cycles. It keeps the choice the way that element does (useScheme),
// so it stays in step with the button in the footer.
// The server can't know what this browser holds, so it marks no choice and takes none: the
// buttons wake up once the page is alive.
// `labelledby` and `describedby` are the ids of the heading and the explanation beside it.
defineProps<{ labelledby: string, describedby?: string }>()

const { t } = useI18n()

const name = useId()
const { current, choose } = useScheme()
</script>

<template>
  <div class="list-chooser-options" role="radiogroup" :aria-labelledby="labelledby" :aria-describedby="describedby">
    <label v-for="scheme in SCHEMES" :key="scheme" class="list-chooser-option">
      <input type="radio" :name="name" :value="scheme" :checked="current === scheme" :disabled="current === null" @change="choose(scheme)">
      <span>{{ t(SCHEME_LABEL[scheme]) }}</span>
    </label>
  </div>
</template>
