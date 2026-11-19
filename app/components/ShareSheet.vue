<script setup lang="ts">
// "Delen" on a list: one sheet with every way the list gets to other people. The link to copy,
// for an owner a switch per friend, and the device's own share sheet where it has one. An
// owner also has one switch above it all that turns the sheet into an invitation: the link is
// then the list's invitation link, and a friend's switch invites them to co-own the list.
// It says almost nothing, on purpose: one sentence, and only while it invites.
//
// A friend's switch saves the moment it is used. While inviting, the switches start off every
// time the sheet opens and don't show what was sent before: a switch that came back off by
// itself would tell the owner that a friend said no, which nobody is told here.
const props = defineProps<{ token: string, title: string, text: string, owner: boolean }>()
// `close` when the sheet went away, however: the page puts the focus back on its button, which
// a browser only does by itself when that button had the focus (Safari doesn't give it on a click).
defineEmits<{ close: [] }>()

const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()
const id = useId()

type Friend = { id: number, name: string, shown: boolean }

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const heading = useTemplateRef<HTMLElement>('heading')
const inviting = ref(false)
// The invitation link, once the server gave it. The buttons that hand it on wait for it:
// Safari only copies during the press itself, so it can't be fetched after one.
const invitePath = ref<string | null>(null)
const friends = ref<Friend[]>([])
const invited = reactive(new Set<number>())
const error = ref('')
const status = ref('')
// Whether this browser has a share sheet is only known in the browser.
const canShare = ref(false)
onMounted(() => {
  canShare.value = typeof navigator.share === 'function'
})

const path = computed(() => (inviting.value ? invitePath.value : localePath(`/l/${props.token}`)))
const words = computed(() => (inviting.value ? t('list.inviteShareText', { title: props.title }) : props.text))

/** Opens the sheet as it always starts: sharing, not inviting. */
function open() {
  if (!dialog.value || dialog.value.open) return
  inviting.value = false
  invitePath.value = null
  invited.clear()
  error.value = ''
  status.value = ''
  dialog.value.showModal()
  // The heading rather than the first control: a screen reader starts with what this is.
  heading.value?.focus()
  // Not waited for: the sheet is of use without its friends, and they join it when they arrive.
  if (props.owner) {
    $fetch<{ friends: Friend[] }>(`/api/lists/${props.token}/friends`)
      .then((answer) => { friends.value = answer.friends })
      .catch(() => { friends.value = [] })
  }
}

async function setInviting(event: Event) {
  const box = event.target as HTMLInputElement
  inviting.value = box.checked
  error.value = ''
  if (!box.checked || invitePath.value) return
  try {
    const made = await $fetch<{ invite: string }>(`/api/lists/${props.token}/invites`, { method: 'POST', body: { kind: 'list' } })
    invitePath.value = localePath(`/j/${made.invite}`)
  }
  catch (failure) {
    // Without a link there is nothing to invite with: back to sharing, and why.
    inviting.value = false
    error.value = parse(failure).message
  }
}

const isOn = (friend: Friend) => (inviting.value ? invited.has(friend.id) : friend.shown)

async function setFriend(friend: Friend, event: Event) {
  const box = event.target as HTMLInputElement
  const on = box.checked
  const invites = inviting.value
  const apply = (value: boolean) => {
    if (!invites) friend.shown = value
    else if (value) invited.add(friend.id)
    else invited.delete(friend.id)
  }
  apply(on)
  error.value = ''
  try {
    await $fetch<unknown>(`/api/lists/${props.token}/friends/${friend.id}`, { method: 'PUT', body: invites ? { invited: on } : { shown: on } })
    const said = invites ? (on ? 'share.nowInvited' : 'share.notInvited') : (on ? 'share.nowShown' : 'share.notShown')
    status.value = t(said, { name: friend.name })
  }
  catch (failure) {
    apply(!on)
    // The box is the browser's own: put it back where the page says it is.
    box.checked = !on
    error.value = parse(failure).message
  }
}

/** Keeps a press from handing on a link that isn't there yet. */
function whenReady(event: Event) {
  if (path.value) return
  event.preventDefault()
  event.stopPropagation()
}

/** A click on the backdrop lands on the dialog element itself, which has no padding of its own. */
function onClick(event: MouseEvent) {
  if (event.target === dialog.value) dialog.value?.close()
}

defineExpose({ open })
</script>

<template>
  <dialog ref="dialog" class="dialog sheet" :aria-labelledby="`${id}-title`" @click="onClick" @close="$emit('close')">
    <div class="sheet-body">
      <div class="sheet-head">
        <h2 :id="`${id}-title`" ref="heading" tabindex="-1">{{ t('share.open') }}</h2>
        <button type="button" class="icon-button" :aria-label="t('share.close')" @click="dialog?.close()">
          <AppIcon name="close" />
        </button>
      </div>

      <template v-if="owner">
        <label class="switch sheet-row">
          <input type="checkbox" :checked="inviting" :aria-describedby="inviting ? `${id}-note` : undefined" @change="setInviting">
          {{ t('share.asOwner') }}
        </label>
        <p v-if="inviting" :id="`${id}-note`" class="switch-hint">{{ t('share.asOwnerNote') }}</p>
      </template>

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

      <fieldset v-if="owner && friends.length" class="sheet-friends">
        <legend class="visually-hidden">{{ t('share.friends') }}</legend>
        <label v-for="friend in friends" :key="friend.id" class="switch sheet-row">
          <input type="checkbox" :checked="isOn(friend)" @change="setFriend(friend, $event)">
          <span class="sheet-name">{{ friend.name }}</span>
        </label>
      </fieldset>

      <art-share v-if="canShare" class="sheet-action" :url="path ?? ''" :text="words" :heading="title" :copied-label="t('share.copied')" :manual-label="t('share.manual')">
        <art-button variant="secondary">
          <button type="button" :aria-disabled="path ? undefined : 'true'" @click="whenReady">
            <AppIcon name="share" />{{ t('share.more') }}
          </button>
        </art-button>
      </art-share>

      <p v-if="error" class="form-message" role="alert">{{ error }}</p>
      <!-- Always there, so what a switch did is announced; sighted people see the switch. -->
      <p class="visually-hidden" role="status">{{ status }}</p>
    </div>
  </dialog>
</template>
