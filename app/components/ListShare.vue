<script setup lang="ts">
import type { SheetPerson } from './ShareSheet.vue'

// The share sheet of a list, in the two ways it is opened. "Delen" in the title band shares
// the list: its link, and for an owner the friends who don't find it yet, each one press away.
// "Mede-eigenaar uitnodigen" in edit mode invites: the link is the list's invitation link, and
// a press on a friend sends them the invitation. Inviting is kept to edit mode, where the other
// things are that change who the list belongs to.
//
// Nothing is taken back here. A friend the list went to, or who was invited, is no longer in
// the row; which lists a friend finds can be changed on the friends page, and an invitation
// ends by itself. The server says who was invited the same way whether that friend said no or
// nothing, so the row never tells what a friend did.
const props = defineProps<{ token: string, title: string, text: string, owner: boolean }>()

const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

type Friend = SheetPerson & { shown: boolean, invited: boolean }
type Mode = 'share' | 'invite'

const sheet = useTemplateRef<{ open: (from?: HTMLElement | null) => void }>('sheet')
const mode = ref<Mode>('share')
const friends = ref<Friend[]>([])
// The invitation link, once the server gave it. The buttons that hand it on wait for it:
// Safari only copies during the press itself, so it can't be fetched after one.
const invitePath = ref<string | null>(null)
const busy = reactive(new Set<number>())
const done = reactive(new Set<number>())
const error = ref('')
const status = ref('')
// Counts the openings, so a late answer never lands in a later one.
let opening = 0

const inviting = computed(() => mode.value === 'invite')
const path = computed(() => (inviting.value ? invitePath.value : localePath(`/l/${props.token}`)))
// Who it can still go to. Someone just pressed stays until their tick has been seen.
const people = computed(() => friends.value.filter(friend => done.has(friend.id) || !(inviting.value ? friend.invited : friend.shown)))

function open(how: Mode, from?: HTMLElement | null) {
  mode.value = how
  invitePath.value = null
  friends.value = []
  busy.clear()
  done.clear()
  error.value = ''
  status.value = ''
  const mine = ++opening
  sheet.value?.open(from)
  // Neither is waited for: the sheet is of use at once, and the rest joins it when it arrives.
  if (props.owner) {
    $fetch<{ friends: Friend[] }>(`/api/lists/${props.token}/friends`)
      .then((answer) => { if (mine === opening) friends.value = answer.friends })
      .catch(() => {})
  }
  if (how === 'invite') {
    $fetch<{ invite: string }>(`/api/lists/${props.token}/invites`, { method: 'POST', body: { kind: 'list' } })
      .then((made) => { if (mine === opening) invitePath.value = localePath(`/j/${made.invite}`) })
      .catch((failure) => { if (mine === opening) error.value = parse(failure).message })
  }
}

async function pick(person: SheetPerson) {
  const friend = friends.value.find(one => one.id === person.id)
  if (!friend || busy.has(friend.id) || done.has(friend.id)) return
  const invites = inviting.value
  const mine = opening
  busy.add(friend.id)
  error.value = ''
  try {
    await $fetch<unknown>(`/api/lists/${props.token}/friends/${friend.id}`, { method: 'PUT', body: invites ? { invited: true } : { shown: true } })
    if (invites) friend.invited = true
    else friend.shown = true
    status.value = t(invites ? 'share.nowInvited' : 'share.nowShown', { name: friend.name })
    // The tick is the answer a sighted person gets; then the row closes up.
    done.add(friend.id)
    setTimeout(() => { if (mine === opening) done.delete(friend.id) }, 1200)
  }
  catch (failure) {
    error.value = parse(failure).message
  }
  finally {
    busy.delete(friend.id)
  }
}

defineExpose({ open })
</script>

<template>
  <ShareSheet
    ref="sheet"
    :title="inviting ? t('share.inviteTitle') : t('share.open')"
    :note="inviting ? t('share.asOwnerNote') : undefined"
    :path="path"
    :text="inviting ? t('list.inviteShareText', { title }) : text"
    :people="people"
    :people-label="inviting ? t('share.friendsInvite') : t('share.friends')"
    :busy="busy"
    :done="done"
    :error="error"
    :status="status"
    @pick="pick"
  />
</template>
