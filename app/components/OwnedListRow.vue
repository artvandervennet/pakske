<script setup lang="ts">
import type { OwnedList } from '#shared/schemas/list'

// A list of your own as a row, on the home page and the lists page: its name is the link, and
// the line beside it says how many wishes it has and who you share it with.
// `picking` is the lists page's edit mode: the row gets a box and is the label of that box, so
// tapping it ticks the list instead of opening it.
const props = defineProps<{ list: OwnedList, picking?: boolean, picked?: boolean }>()
defineEmits<{ pick: [on: boolean] }>()

const { t } = useI18n()
const localePath = useLocalePath()
const names = useNames()

const pickId = computed(() => `pick-${props.list.token}`)
const meta = computed(() => {
  const wishes = t('lists.wishes', props.list.wishes)
  return props.list.sharedWith.length ? `${wishes} · ${t('wish.with', { names: names(props.list.sharedWith) })}` : wishes
})
</script>

<template>
  <li class="row" :class="{ picking }">
    <span v-if="picking" class="tick-box">
      <input :id="pickId" type="checkbox" :checked="picked" @change="$emit('pick', ($event.target as HTMLInputElement).checked)">
    </span>
    <!-- The label lays its two parts out as the row does, so the line of detail wraps to under
         the name and not to under the box. -->
    <label v-if="picking" class="row-pick" :for="pickId">
      <span class="row-title">{{ list.title }}</span>
      <span class="row-meta">{{ meta }}</span>
    </label>
    <template v-else>
      <NuxtLink class="row-title" :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
      <span class="row-meta">{{ meta }}</span>
    </template>
  </li>
</template>
