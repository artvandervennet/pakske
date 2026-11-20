<script setup lang="ts">
// The people something can go to in a sheet (ShareSheet.vue, ShareWishesDialog.vue): a row that
// scrolls sideways and snaps, each a picture and a name to press. Pressing one is the whole act,
// so a sheet only puts people in it something hasn't gone to yet; one that was pressed shows a
// tick, and the sheet takes it out after that. The row is named by its sheet, with an
// `aria-label` or `aria-labelledby` that lands on the list.
export interface SheetPerson { id: number, name: string, picture: string | null }

defineProps<{
  people: SheetPerson[]
  /** The people whose press is on its way, and the ones it reached. */
  busy?: Set<number>
  done?: Set<number>
}>()
defineEmits<{ pick: [person: SheetPerson] }>()
</script>

<template>
  <ul class="sheet-people">
    <li v-for="person in people" :key="person.id">
      <button
        type="button"
        class="sheet-person"
        :class="{ done: done?.has(person.id) }"
        :aria-disabled="busy?.has(person.id) || done?.has(person.id) || undefined"
        @click="$emit('pick', person)"
      >
        <span class="sheet-person-picture">
          <PersonPicture :person="person" />
          <AppIcon v-if="done?.has(person.id)" name="check" />
        </span>
        <span class="sheet-person-name">{{ person.name }}</span>
      </button>
    </li>
  </ul>
</template>
