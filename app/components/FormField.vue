<script setup lang="ts">
// A label, the control, an optional hint and an optional error, tied together for screen
// readers. The control goes in the slot and takes `describedBy` and `invalid` from it:
//
//   <FormField id="title" label="Titel" :error="errors.title" v-slot="field">
//     <input id="title" v-model="title" :aria-describedby="field.describedBy" :aria-invalid="field.invalid">
//   </FormField>
const props = defineProps<{ id: string, label: string, hint?: string, error?: string }>()

const describedBy = computed(() =>
  [props.hint && `${props.id}-hint`, props.error && `${props.id}-error`].filter(Boolean).join(' ') || undefined,
)
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <slot :described-by="describedBy" :invalid="error ? ('true' as const) : undefined" />
    <span v-if="hint" :id="`${id}-hint`" class="hint">{{ hint }}</span>
    <span v-if="error" :id="`${id}-error`" class="error">{{ error }}</span>
  </div>
</template>
