<script setup lang="ts">
import type { OpenedList } from '#shared/schemas/list'

// Someone else's list that you opened before, as a row on the home page and the lists page: its
// name, whose it is, a tape when it was deleted, and "Weghalen". The button says only "Weghalen";
// the list's name is its description, so a screen reader says which list it takes away.
// `picking` is the lists page's edit mode: a box takes the place of "Weghalen", and the row is
// the label of that box, so tapping it ticks the list instead of opening it.
// A list a Secret Santa group put on the page says which group, and has neither "Weghalen" nor
// a box: it goes with the group, so in edit mode it stays a plain row that opens.
const props = defineProps<{ list: OpenedList, picking?: boolean, picked?: boolean }>()
defineEmits<{ forget: [token: string], pick: [on: boolean] }>()

const { t } = useI18n()
const localePath = useLocalePath()
const { loggedIn } = useUserSession()
const names = useNames()

const titleId = computed(() => `visited-${props.list.token}`)
const pickId = computed(() => `pick-${props.list.token}`)
// A deleted list still opens for someone logged in, who may have bought something on it.
// For a visitor who isn't, the link would only lead to "not found".
const canOpen = computed(() => !props.list.deleted || loggedIn.value)
// The first group that put it there; a list in several groups is rare, and one name places it.
const group = computed(() => props.list.santa?.[0])
const removable = computed(() => group.value === undefined)
const meta = computed(() => [
  props.list.owners.length ? t('list.owners', { names: names(props.list.owners) }) : '',
  group.value === undefined ? '' : t('santa.listVia', { title: group.value }),
].filter(Boolean).join(' · '))
</script>

<template>
  <li class="row" :class="{ picking }">
    <!-- A row without a box keeps the box's room, so its name starts where the others' do. -->
    <span v-if="picking" class="tick-box" :aria-hidden="removable ? undefined : 'true'">
      <input v-if="removable" :id="pickId" type="checkbox" :checked="picked" @change="$emit('pick', ($event.target as HTMLInputElement).checked)">
    </span>
    <label v-if="picking && removable" class="row-text" :for="pickId">
      <span class="row-title">{{ list.title }}</span>
      <span v-if="meta" class="row-meta">{{ meta }}</span>
    </label>
    <div v-else class="row-text">
      <NuxtLink v-if="canOpen" :id="titleId" class="row-title" :to="localePath(`/l/${list.token}`)">{{ list.title }}</NuxtLink>
      <span v-else :id="titleId" class="row-title">{{ list.title }}</span>
      <span v-if="meta" class="row-meta">{{ meta }}</span>
    </div>
    <art-tape v-if="list.deleted" :seed="list.token">{{ t('lists.deleted') }}</art-tape>
    <art-button v-if="!picking && removable" variant="quiet" size="s">
      <button type="button" :aria-describedby="titleId" @click="$emit('forget', list.token)">{{ t('lists.remove') }}</button>
    </art-button>
  </li>
</template>
