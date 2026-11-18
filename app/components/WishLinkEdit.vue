<script setup lang="ts">
import type { OwnerWish } from '#shared/schemas/list'
import type { WishSave } from '~/composables/useWishSave'

// The shop links in an owner's row, each shown as the link it is, with a quiet "Change" and
// "Remove" beside it, and "Add link" under them while there is room for one more. Changing or
// adding turns that one link into a field in place; saving or Escape turns it back. The links
// save together, as one list, so every change sends them all.
const props = defineProps<{ wish: OwnerWish, saving: WishSave }>()

const { t } = useI18n()
// The saved links: the list's, or the ones just saved until the list has them (also when the
// refresh after the save fails).
const saved = ref([...props.wish.urls])
watch(() => props.wish.urls, (urls) => {
  saved.value = [...urls]
})
const names = computed(() => linkNames(saved.value))
// The place of the link being typed: one of the list's, or the list's length for a new one.
const editing = ref<number | null>(null)
// One line per link, and one more for a link being added. A line is known by its place, not by
// its link, so the field stays the same field while its link is saved: it only turns back into
// a link when it says it is done.
const lines = computed(() => editing.value === saved.value.length ? [...saved.value, ''] : saved.value)
const root = useTemplateRef<HTMLElement>('root')
// Taking a link off is a request of its own; one at a time.
const removing = ref(false)
const error = ref('')

/** What the field of the link at `index` calls to save what it holds. */
const saverAt = (index: number) => async (text: string): Promise<string | null> => {
  const change = linkChange(saved.value, index, text)
  const reason = await props.saving.save(change)
  if (!reason && change) saved.value = change.urls
  return reason
}

async function change(index: number) {
  error.value = ''
  editing.value = index
  await nextTick()
  // Only one link is a field at a time, so the one field in here is the one just opened.
  const field = root.value?.querySelector<HTMLInputElement>('input')
  field?.focus()
  field?.select()
}

/** Puts the focus on a link's "Change", or on "Add link" when that link isn't there. */
function focusButton(index: number) {
  const button = root.value?.querySelector<HTMLButtonElement>(`[data-link-change="${index}"]`)
    ?? root.value?.querySelector<HTMLButtonElement>('[data-link-add]')
  button?.focus()
}

async function onDone(index: number, how: 'enter' | 'escape' | 'blur') {
  editing.value = null
  // After leaving the field by clicking elsewhere, the focus is where that click put it.
  if (how === 'blur') return
  await nextTick()
  focusButton(index)
}

function remove(index: number) {
  const url = saved.value[index]
  if (removing.value || url === undefined) return
  // A field left with a change by this very click is saving the list right now. Taking the link
  // off the list as it was before that would undo it, so this waits and looks the link up again.
  // When that save fails, its reason shows beside the field and nothing is taken off.
  props.saving.whenSaved(async () => {
    if (removing.value) return
    removing.value = true
    error.value = ''
    const at = saved.value.indexOf(url)
    const change = at === -1 ? null : linkRemoval(saved.value, at)
    const reason = await props.saving.save(change)
    removing.value = false
    if (reason) {
      error.value = reason
      return
    }
    if (change) saved.value = change.urls
    await nextTick()
    // The button went with its link. "Add link" is always there after one was taken off.
    focusButton(-1)
  })
}
</script>

<template>
  <div ref="root" class="wish-link-edit">
    <ul v-if="lines.length" class="wish-links">
      <li v-for="(url, index) in lines" :key="index">
        <template v-if="editing !== index">
          <art-button variant="secondary" size="s">
            <a :href="url" target="_blank" rel="noopener noreferrer">{{ t('wish.viewOn', { host: names[index] }) }}</a>
          </art-button>
          <art-button variant="quiet" size="s">
            <button type="button" :data-link-change="index" :aria-label="t('edit.linkChangeLabel', { host: names[index] })" @click="change(index)">
              {{ t('edit.linkChange') }}
            </button>
          </art-button>
          <art-button variant="quiet" size="s">
            <button type="button" :aria-label="t('edit.linkRemoveLabel', { host: names[index] })" :aria-disabled="removing || undefined" @click="remove(index)">
              {{ t('edit.linkRemove') }}
            </button>
          </art-button>
        </template>
        <EditableText
          v-else
          kind="url"
          :value="url"
          :label="t('edit.link')"
          placeholder="https://"
          :save="saverAt(index)"
          :maxlength="2000"
          @done="onDone(index, $event)"
        />
      </li>
    </ul>
    <art-button v-if="editing !== saved.length && saved.length < MAX_LINKS" variant="quiet" size="s">
      <button type="button" data-link-add @click="change(saved.length)">{{ t('edit.linkAdd') }}</button>
    </art-button>
    <p v-if="error" class="inline-field-error" role="alert">{{ error }}</p>
  </div>
</template>
