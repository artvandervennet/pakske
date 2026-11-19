<script setup lang="ts">
// A link to send, right after it was made: what it does, the full address to read or
// select, and the button that sends it on with the device's share sheet, with the words in
// `share`. A browser without a share sheet gets a button that copies it. The group is named by
// its sentence, so the button inside can't be taken for the one that shares the list itself.
const props = defineProps<{ path: string, text: string, share?: { title: string, text: string } }>()
const { t } = useI18n()

const id = useId()
const origin = useRequestURL().origin
const address = computed(() => origin + props.path)
const field = useTemplateRef<HTMLInputElement>('field')
const button = useTemplateRef<{ share: () => Promise<boolean> }>('button')

/** Puts the focus on the address, selected, so it can be copied at once. */
function focus() {
  field.value?.focus()
  field.value?.select()
}
/** Opens the share sheet for a link that was just made, where the browser has one and lets it. */
const openSheet = () => button.value?.share() ?? Promise.resolve(false)

defineExpose({ focus, share: openSheet })
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
    <ShareButton ref="button" :path="path" :share="props.share" />
  </div>
</template>
