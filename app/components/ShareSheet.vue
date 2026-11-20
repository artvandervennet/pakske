<script setup lang="ts">
// A sheet for handing something on: a link to copy, the people it can go to straight away, and
// the device's own share sheet where it has one. A centred card on a wide screen, against the
// bottom edge on a narrow one. It says as little as it can: a title, at most one line of
// `note`, and names under pictures.
//
// The people are a row of pictures to press (SheetPeople.vue). Pressing one is the whole act:
// there is nothing to undo here, so only people it hasn't gone to yet are in the row.
// What a press does, and what the link is, is the page's business: it hands in `path` (null
// while the link is still being made, and the buttons wait for it) and listens for `pick`.
import type { SheetPerson } from './SheetPeople.vue'

const props = defineProps<{
  title: string
  /** The address to hand on, on this site; null while it isn't there yet. */
  path: string | null
  /** The words that go along with it in the device's share sheet. */
  text?: string
  note?: string
  people?: SheetPerson[]
  /** What pressing a person does, as the name of the row for a screen reader. */
  peopleLabel?: string
  /** The people whose press is on its way, and the ones it reached. */
  busy?: Set<number>
  done?: Set<number>
  error?: string
  /** What just happened, said to a screen reader; sighted people see the row change. */
  status?: string
}>()
defineEmits<{ pick: [person: SheetPerson] }>()

const { t } = useI18n()
const id = useId()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLElement>('heading')
// What opened the sheet, to give the focus back to: a browser only does that by itself when
// that control had the focus, and Safari doesn't give a button the focus on a click.
let opener: HTMLElement | null = null
// Whether this browser has a share sheet is only known in the browser.
const canShare = ref(false)
onMounted(() => {
  canShare.value = typeof navigator.share === 'function'
})

function open(from?: HTMLElement | null) {
  if (!dialog.value || dialog.value.open) return
  opener = from ?? null
  dialog.value.showModal()
  // The heading rather than the first control: a screen reader starts with what this is.
  heading.value?.focus()
}

/** Keeps a press from handing on a link that isn't there yet. */
function whenReady(event: Event) {
  if (props.path) return
  event.preventDefault()
  event.stopPropagation()
}

/** A click on the backdrop lands on the dialog element itself, which has no padding of its own. */
function onClick(event: MouseEvent) {
  if (event.target === dialog.value) dialog.value?.close()
}

defineExpose({ open, close: () => dialog.value?.close() })
</script>

<template>
  <dialog ref="dialog" class="dialog sheet" :aria-labelledby="`${id}-title`" :aria-describedby="note ? `${id}-note` : undefined" @click="onClick" @close="opener?.focus()">
    <div class="sheet-body">
      <div class="sheet-head">
        <h2 :id="`${id}-title`" ref="heading" tabindex="-1">{{ title }}</h2>
        <button type="button" class="icon-button" :aria-label="t('share.close')" @click="dialog?.close()">
          <AppIcon name="close" />
        </button>
      </div>
      <p v-if="note" :id="`${id}-note`" class="switch-hint">{{ note }}</p>

      <SheetPeople v-if="people?.length" :people="people" :busy="busy" :done="done" :aria-label="peopleLabel" @pick="$emit('pick', $event)" />

      <art-share class="sheet-action" nosheet :url="path ?? ''" :copied-label="t('share.copied')" :manual-label="t('share.manual')">
        <art-button variant="secondary">
          <button type="button" :aria-disabled="path ? undefined : 'true'" @click="whenReady">
            <span class="wordings">
              <span data-when="copy"><AppIcon name="link" />{{ t('share.copy') }}</span>
              <span data-when="copied"><AppIcon name="check" />{{ t('share.copiedShort') }}</span>
            </span>
          </button>
        </art-button>
      </art-share>

      <art-share v-if="canShare" class="sheet-action" :url="path ?? ''" :text="text" :copied-label="t('share.copied')" :manual-label="t('share.manual')">
        <art-button variant="secondary">
          <button type="button" :aria-disabled="path ? undefined : 'true'" @click="whenReady">
            <AppIcon name="share" />{{ t('share.more') }}
          </button>
        </art-button>
      </art-share>

      <p v-if="error" class="form-message" role="alert">{{ error }}</p>
      <!-- Always there, so what a press did is announced. -->
      <p class="visually-hidden" role="status">{{ status }}</p>
    </div>
  </dialog>
</template>
