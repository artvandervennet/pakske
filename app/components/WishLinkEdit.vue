<script setup lang="ts">
import type { OwnerWish } from '#shared/schemas/list'
import type { WishSave } from '~/composables/useWishSave'

// The shop links in an owner's card, under the label "Links": each a line with the shop's name
// as the link it is, and two small buttons after it, a pencil to change it and a cross to take
// it off. "Link toevoegen" is under them while there is room for one more. Changing or adding
// turns that one line into a field in place; saving or Escape turns it back. The links save
// together, as one list, so every change sends them all.
const props = defineProps<{ wish: OwnerWish, saving: WishSave }>()

const { t } = useI18n()
const id = useId()
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

/** Puts the focus on a link's pencil, or on "Link toevoegen" when that link isn't there. */
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
  <div ref="root" class="wish-link-edit" role="group" :aria-labelledby="`${id}-label`">
    <span :id="`${id}-label`" class="wish-label">{{ t('edit.links') }}</span>
    <ul v-if="lines.length" class="wish-link-rows">
      <li v-for="(url, index) in lines" :key="index">
        <template v-if="editing !== index">
          <AppIcon name="link" />
          <a class="wish-link-name" :href="url" target="_blank" rel="noopener noreferrer">{{ names[index] }}</a>
          <button
            type="button"
            class="icon-button"
            :data-link-change="index"
            :aria-label="t('edit.linkChange', { host: names[index] })"
            :title="t('edit.linkChange', { host: names[index] })"
            @click="change(index)"
          >
            <AppIcon name="pencil" />
          </button>
          <button
            type="button"
            class="icon-button"
            :aria-label="t('edit.linkRemove', { host: names[index] })"
            :title="t('edit.linkRemove', { host: names[index] })"
            :aria-disabled="removing || undefined"
            @click="remove(index)"
          >
            <AppIcon name="close" />
          </button>
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
    <button v-if="editing !== saved.length && saved.length < MAX_LINKS" type="button" class="text-button" data-link-add @click="change(saved.length)">
      <AppIcon name="plus" />
      {{ t('edit.linkAdd') }}
    </button>
    <p v-if="error" class="inline-field-error" role="alert">{{ error }}</p>
  </div>
</template>
