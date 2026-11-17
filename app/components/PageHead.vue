<script setup lang="ts">
// The band in the deep paint that opens every page. <art-header> takes its paint from the
// first band, so without this one the header would not be deep.
defineProps<{ title: string, lead?: string | null }>()
</script>

<template>
  <div class="band page-head" data-paint="deep">
    <div class="inner">
      <slot name="crumb" />
      <h1>{{ title }}</h1>
      <p v-if="lead" class="lead">{{ lead }}</p>
      <div v-if="$slots.actions" class="actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
