<script setup lang="ts">
// A person's picture, round: the one they put up, or without one a study in two of Gesso's
// paints, as a wish without a photo has (WishThumb.vue). The paints come from the account's id
// alone, so the server and the browser draw the same one and a person keeps their colours.
// It is decoration beside a name that is always there, so it says nothing to a screen reader.
const props = defineProps<{ person: { id: number, picture: string | null } }>()

const study = computed(() => {
  const first = props.person.id % 8
  const second = (first + 3) % 8
  return {
    '--study-a': `var(--paint-${first + 1}-rule)`,
    '--study-b': `var(--paint-${second + 1}-rule)`,
    '--study-angle': `${45 + (props.person.id % 4) * 45}deg`,
  }
})
</script>

<template>
  <img v-if="person.picture" class="person-picture" :src="person.picture" alt="" width="56" height="56" loading="lazy" decoding="async">
  <span v-else class="person-picture study" :style="study" aria-hidden="true" />
</template>
