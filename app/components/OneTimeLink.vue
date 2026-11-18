<script setup lang="ts">
// A link to send, right after it was made: what it does, the full address to read or
// select, and the button that copies it. The group is named by its sentence, so the copy button
// inside can't be taken for the one that copies the list's own address.
const props = defineProps<{ path: string, text: string }>()
const { t } = useI18n()

const id = useId()
const origin = useRequestURL().origin
const address = computed(() => origin + props.path)
const field = useTemplateRef<HTMLInputElement>('field')

/** Puts the focus on the address, selected, so it can be copied at once. */
function focus() {
  field.value?.focus()
  field.value?.select()
}
defineExpose({ focus })
</script>

<template>
  <div class="one-time-link" role="group" :aria-labelledby="`${id}-text`">
    <p :id="`${id}-text`" class="one-time-link-text">{{ text }}</p>
    <input
      ref="field"
      type="text"
      class="one-time-link-address"
      readonly
      :value="address"
      :aria-label="t('share.manual')"
      @focus="field?.select()"
    >
    <ShareButton :path="path" />
  </div>
</template>
