<script setup lang="ts">
// The small picture at the start of a row. Without one, a study in two of Gesso's paints.
// The paints come from the id alone, so the server and the browser draw the same one and a
// wish keeps its colours when the list changes around it.
const props = defineProps<{ wish: { id: number, image: string | null } }>()

const study = computed(() => {
  const first = props.wish.id % 8
  // Three paints along the wheel: far enough apart to tell the two halves apart.
  const second = (first + 3) % 8
  return {
    // The rule shade of a paint: the paints themselves are too close to the page after dark.
    '--study-a': `var(--paint-${first + 1}-rule)`,
    '--study-b': `var(--paint-${second + 1}-rule)`,
    '--study-angle': `${45 + (props.wish.id % 4) * 45}deg`,
  }
})
</script>

<template>
  <img
    v-if="wish.image"
    class="wish-thumb"
    :src="wish.image"
    alt=""
    width="48"
    height="48"
    loading="lazy"
    decoding="async"
  >
  <span v-else class="wish-thumb study" :style="study" aria-hidden="true" />
</template>
