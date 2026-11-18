<script setup lang="ts">
// A label, the control and an optional error, tied together for screen readers. A hint is part
// of the label, on a line of its own under it: read before the field, by eye and by screen
// reader alike, so it needs no description of its own. The control goes in the slot and takes
// `describedBy` and `invalid` from it:
//
//   <FormField id="title" label="Titel" :error="errors.title" v-slot="field">
//     <input id="title" v-model="title" :aria-describedby="field.describedBy" :aria-invalid="field.invalid">
//   </FormField>
const props = defineProps<{ id: string, label: string, hint?: string, error?: string }>()

const describedBy = computed(() => (props.error ? `${props.id}-error` : undefined))
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }} <span v-if="hint" class="hint">{{ hint }}</span></label>
    <slot :described-by="describedBy" :invalid="error ? ('true' as const) : undefined" />
    <span v-if="error" :id="`${id}-error`" class="error">{{ error }}</span>
  </div>
</template>
