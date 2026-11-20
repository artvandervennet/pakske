<script setup lang="ts">
import type { SheetPerson } from './SheetPeople.vue'

// "Delen" on wishes of a list of your own: a sheet, like the one that shares a list. First how:
// Kopie gives whoever gets them wishes of their own, Samen makes them an owner of these. Then
// to whom: a press on a friend's picture sends it to them in that way, as a notice they decide
// on, and the friend leaves the row. "Link maken" makes a link to send some other way instead,
// and the sheet shows it, with the device's share sheet straight on top where there is one.
// The link is only made on that press: one made on every opening would push out older links
// that were sent but not opened yet, as only so many stay open.
// The dialog makes the link or sends itself, so any button on the page can open it for the
// wishes that button is about. The browser gives the focus back to that button when the dialog
// closes. `close` says whether a link was made or something sent; `failed` that it was refused,
// which usually means the list changed meanwhile.
const props = defineProps<{ token: string, wishIds: number[] }>()
const emit = defineEmits<{ close: [made: boolean], failed: [] }>()

const { t } = useI18n()
const { parse } = useApiError()
const localePath = useLocalePath()
const id = useId()

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLElement>('heading')
const linkBox = useTemplateRef<{ focus: () => void, share: () => Promise<boolean> }>('linkBox')

// The wishes this opening is about: the page may clear its ticks while the sheet is open.
const ids = ref<number[]>([])
// The words that go along with the link in the share sheet.
const shareWords = computed(() => ({
  title: t('site.name'),
  text: t(mode.value === 'copy' ? 'share.copyShareText' : 'share.linkedShareText', { n: ids.value.length }, ids.value.length),
}))
const mode = ref<'copy' | 'linked'>('copy')
const path = ref<string | null>(null)
// The friends these wishes can go to, and the ones they went to in this opening.
const friends = ref<SheetPerson[]>([])
const sent = reactive(new Set<number>())
const busy = reactive(new Set<number>())
const done = reactive(new Set<number>())
const making = ref(false)
const error = ref('')
const status = ref('')
// Counts the openings, so a late answer never lands in a later one.
let opening = 0

// Who it can still go to. Someone just pressed stays until their tick has been seen.
const people = computed(() => friends.value.filter(friend => done.has(friend.id) || !sent.has(friend.id)))

/** Opens the sheet on its first step, for the wishes in `wishIds`. */
async function open() {
  if (!dialog.value || dialog.value.open || !props.wishIds.length) return
  ids.value = [...props.wishIds]
  mode.value = 'copy'
  path.value = null
  sent.clear()
  busy.clear()
  done.clear()
  error.value = ''
  status.value = ''
  const mine = ++opening
  // Not waited for: the sheet opens at once, and friends join it when they arrive.
  friends.value = []
  $fetch<{ friends: SheetPerson[] }>(`/api/lists/${props.token}/friends`)
    .then((answer) => { if (mine === opening) friends.value = answer.friends })
    .catch(() => {})
  // The first step renders before the sheet shows, so it never opens on the last link.
  await nextTick()
  dialog.value.showModal()
  // The heading rather than the first choice: a screen reader starts with what this is about.
  heading.value?.focus()
}

function refused(failure: unknown) {
  const parsed = parse(failure)
  error.value = parsed.fields.wishIds ? t('joint.tooMany') : parsed.message
  emit('failed')
}

async function send(friend: SheetPerson) {
  if (busy.has(friend.id) || done.has(friend.id)) return
  const mine = opening
  busy.add(friend.id)
  error.value = ''
  try {
    await $fetch<unknown>(`/api/lists/${props.token}/invites`, {
      method: 'POST',
      body: { kind: 'wishes', mode: mode.value, wishIds: ids.value, friends: [friend.id] },
    })
    if (mine !== opening) return
    sent.add(friend.id)
    status.value = t('share.nowSent', { name: friend.name })
    // The tick is the answer a sighted person gets; then the row closes up.
    done.add(friend.id)
    setTimeout(() => { if (mine === opening) done.delete(friend.id) }, 1200)
  }
  catch (failure) {
    if (mine === opening) refused(failure)
  }
  finally {
    busy.delete(friend.id)
  }
}

async function make() {
  if (making.value) return
  making.value = true
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
    // And straight on to the share sheet, where there is one. Not waited for: the link is made.
    void linkBox.value?.share()
  }
  catch (failure) {
    refused(failure)
  }
  finally {
    making.value = false
  }
}

/** A click on the backdrop lands on the dialog element itself, which has no padding of its own. */
function onClick(event: MouseEvent) {
  if (event.target === dialog.value) dialog.value?.close()
}

function onClose() {
  // Escape sets no value, and browsers differ on whether it clears the last one: reset it.
  if (dialog.value) dialog.value.returnValue = ''
  emit('close', path.value !== null || sent.size > 0)
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="dialog sheet" :aria-labelledby="`${id}-title`" @click="onClick" @close="onClose">
    <div class="sheet-body">
      <div class="sheet-head">
        <h2 :id="`${id}-title`" ref="heading" tabindex="-1">
          {{ path ? t('share.readyTitle') : t('share.title', { n: ids.length }, ids.length) }}
        </h2>
        <button type="button" class="icon-button" :aria-label="t('share.close')" @click="dialog?.close()">
          <AppIcon name="close" />
        </button>
      </div>

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

        <div v-if="people.length" class="share-people">
          <p :id="`${id}-people`" class="share-modes-legend">{{ t('share.toFriends') }}</p>
          <SheetPeople :people="people" :busy="busy" :done="done" :aria-labelledby="`${id}-people`" @pick="send" />
        </div>

        <div class="sheet-action">
          <art-button variant="secondary">
            <button type="button" :aria-disabled="making || undefined" @click="make">
              <AppIcon name="link" />{{ t('share.make') }}
            </button>
          </art-button>
        </div>
      </template>
      <OneTimeLink v-else ref="linkBox" :path="path" :text="mode === 'copy' ? t('share.copyLinkText') : t('share.linkedLinkText')" :share="shareWords" />

      <p v-if="error" class="form-message" role="alert">{{ error }}</p>
      <!-- Always there, so what a press did is announced. -->
      <p class="visually-hidden" role="status">{{ status }}</p>
    </div>
  </dialog>
</template>
