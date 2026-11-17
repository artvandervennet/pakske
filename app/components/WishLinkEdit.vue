<script setup lang="ts">
import type { OwnerWish } from '#shared/schemas/list'
import type { WishSave } from '~/composables/useWishSave'

// The shop link in an owner's row, shown as the link it is. A quiet "Change" beside it, or
// "Add link" without one, turns it into a field in place; saving or Escape turns it back.
const props = defineProps<{ wish: OwnerWish, saving: WishSave }>()

const { t } = useI18n()
// The saved link: the list's, or the one just saved until the list has it (also when the
// refresh after the save fails).
const savedUrl = ref(props.wish.url)
watch(() => props.wish.url, (url) => {
  savedUrl.value = url
})
const host = computed(() => hostOf(savedUrl.value))
const changing = ref(false)
const field = useTemplateRef<{ focus: (select?: boolean) => void }>('field')
const button = useTemplateRef<HTMLButtonElement>('button')

async function save(text: string, saved: string): Promise<string | null> {
  const reason = await props.saving.save(fieldChange('url', text, saved))
  if (!reason) savedUrl.value = cleanText(text, 'url') || null
  return reason
}

async function change() {
  changing.value = true
  await nextTick()
  field.value?.focus(true)
}

async function onDone(how: 'enter' | 'escape' | 'blur') {
  changing.value = false
  // After leaving the field by clicking elsewhere, the focus is where that click put it.
  if (how === 'blur') return
  await nextTick()
  button.value?.focus()
}
</script>

<template>
  <div class="wish-link-edit">
    <EditableText
      v-if="changing"
      ref="field"
      kind="url"
      :value="savedUrl ?? ''"
      :label="t('edit.link')"
      placeholder="https://"
      :save="save"
      :maxlength="2000"
      @done="onDone"
    />
    <template v-else>
      <art-button v-if="savedUrl && host" variant="secondary" size="s">
        <a :href="savedUrl" target="_blank" rel="noopener noreferrer">{{ t('wish.viewOn', { host }) }}</a>
      </art-button>
      <art-button variant="quiet" size="s">
        <button ref="button" type="button" :aria-label="savedUrl ? t('edit.linkChangeLabel') : undefined" @click="change">
          {{ savedUrl ? t('edit.linkChange') : t('edit.linkAdd') }}
        </button>
      </art-button>
    </template>
  </div>
</template>
