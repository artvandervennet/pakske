<script setup lang="ts">
// Which friends something is sent to: a switch per friend, all off at first. The sentence under
// them says what a friend gets, and what happens when nobody is chosen.
defineProps<{ friends: { id: number, name: string }[], legend: string, hint: string }>()
const chosen = defineModel<number[]>({ required: true })
const id = useId()
</script>

<template>
  <fieldset class="friend-shows send-to" :aria-describedby="`${id}-hint`">
    <legend class="share-modes-legend">{{ legend }}</legend>
    <label v-for="friend in friends" :key="friend.id" class="switch">
      <input v-model="chosen" type="checkbox" :value="friend.id">
      {{ friend.name }}
    </label>
    <p :id="`${id}-hint`" class="switch-hint">{{ hint }}</p>
  </fieldset>
</template>
