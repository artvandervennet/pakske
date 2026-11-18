<script setup lang="ts">
// The band in the deep paint that opens every page. <art-header> takes its paint from the
// first band, so without this one the header would not be deep. The title slot replaces the
// heading, for a page that lets you rename what it shows. The band ends in paint running
// down, like the home page's hero; <art-header> takes those drips along on scroll.
defineProps<{ title: string, lead?: string | null }>()
</script>

<template>
  <div class="band page-head" data-paint="deep">
    <div class="inner">
      <slot name="title">
        <h1>{{ title }}</h1>
      </slot>
      <p v-if="lead" class="lead">{{ lead }}</p>
      <div v-if="$slots.actions" class="actions">
        <slot name="actions" />
      </div>
    </div>
    <art-drip class="band-drip" pigment="--surface" stagger flush />
  </div>
</template>
