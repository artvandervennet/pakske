<script setup lang="ts">
// "Delen" on wishes of a list of your own, in two steps: choose how, then the link to send.
// Kopie gives whoever opens the link wishes of their own; Samen makes them an owner of these.
// The dialog makes the link itself, so any button on the page can open it for the wishes that
// button is about. The browser gives the focus back to that button when the dialog closes.
// `close` says whether a link was made; `failed` that making one was refused, which usually
// means the list changed meanwhile.
const props = defineProps<{ token: string, wishIds: number[] }>()
const emit = defineEmits<{ close: [made: boolean], failed: [] }>()

const { t } = useI18n()
const { parse } = useApiError()
const localePath = useLocalePath()
const id = useId()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLElement>('heading')
const linkBox = useTemplateRef<{ focus: () => void }>('linkBox')

// The wishes this opening is about: the page may clear its ticks while the link is on view.
const ids = ref<number[]>([])
const mode = ref<'copy' | 'linked'>('copy')
const path = ref<string | null>(null)
const busy = ref(false)
const error = ref('')

/** Opens the dialog on its first step, for the wishes in `wishIds`. */
async function open() {
  if (!dialog.value || dialog.value.open || !props.wishIds.length) return
  ids.value = [...props.wishIds]
  mode.value = 'copy'
  path.value = null
  error.value = ''
  // The first step renders before the dialog shows, so it never opens on the last link.
  await nextTick()
  dialog.value.showModal()
  // The heading rather than the first choice: a screen reader starts with what this is about.
  heading.value?.focus()
}

async function make() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const made = await $fetch<{ invite: string }>(`/api/lists/${props.token}/invites`, {
      method: 'POST',
      body: { kind: 'wishes', mode: mode.value, wishIds: ids.value },
    })
    path.value = localePath(`/j/${made.invite}`)
    // The button that was pressed is gone with the first step: on to the address, selected.
    await nextTick()
    linkBox.value?.focus()
  }
  catch (failure) {
    const parsed = parse(failure)
    error.value = parsed.fields.wishIds ? t('joint.tooMany') : parsed.message
    emit('failed')
  }
  finally {
    busy.value = false
  }
}

function onClose() {
  // Escape sets no value, and browsers differ on whether it clears the last one: reset it.
  if (dialog.value) dialog.value.returnValue = ''
  emit('close', path.value !== null)
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="dialog share-dialog" :aria-labelledby="`${id}-title`" @close="onClose">
    <h2 :id="`${id}-title`" ref="heading" tabindex="-1">
      {{ path ? t('share.readyTitle') : t('share.title', { n: ids.length }, ids.length) }}
    </h2>
    <template v-if="!path">
      <fieldset class="share-modes">
        <legend class="share-modes-legend">{{ t('share.how') }}</legend>
        <label class="share-mode">
          <input v-model="mode" type="radio" :name="`${id}-mode`" value="copy">
          <span class="share-mode-name">{{ t('share.modeCopy') }}</span>
          <span class="share-mode-hint">{{ t('share.modeCopyHint') }}</span>
        </label>
        <label class="share-mode">
          <input v-model="mode" type="radio" :name="`${id}-mode`" value="linked">
          <span class="share-mode-name">{{ t('share.modeLinked') }}</span>
          <span class="share-mode-hint">{{ t('share.modeLinkedHint', ids.length) }}</span>
        </label>
      </fieldset>
      <p v-if="error" class="form-message" role="alert">{{ error }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel">{{ t('share.cancel') }}</button>
        </art-button>
        <art-button>
          <button type="button" :aria-disabled="busy || undefined" @click="make">{{ t('share.make') }}</button>
        </art-button>
      </form>
    </template>
    <template v-else>
      <OneTimeLink ref="linkBox" :path="path" :text="mode === 'copy' ? t('share.copyLinkText') : t('share.linkedLinkText')" />
      <form method="dialog" class="actions">
        <art-button>
          <button value="done">{{ t('share.done') }}</button>
        </art-button>
      </form>
    </template>
  </dialog>
</template>
