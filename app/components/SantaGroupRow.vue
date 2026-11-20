<script setup lang="ts">
import type { SantaGroupRow } from '#shared/schemas/santa'

// A Secret Santa group the person is in, as a row: its name is the link, and the line beside it
// says how many are in and whether the names are drawn. Never whose name anyone drew: that is
// on the group's own page, behind a button.
const props = defineProps<{ group: SantaGroupRow }>()

const { t } = useI18n()
const localePath = useLocalePath()

const meta = computed(() =>
  `${t('santa.rowMembers', { n: props.group.members }, props.group.members)} · ${t(props.group.drawn ? 'santa.rowDrawn' : 'santa.rowOpen')}`)
</script>

<template>
  <li class="row">
    <NuxtLink class="row-title" :to="localePath(`/s/${group.token}`)">{{ group.title }}</NuxtLink>
    <span class="row-meta">{{ meta }}</span>
  </li>
</template>
