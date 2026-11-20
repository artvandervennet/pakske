<script setup lang="ts">
import { SANTA_MIN_MEMBERS, type SantaMember, type SantaView } from '#shared/schemas/santa'

// A Secret Santa group, at its own address, which is also its invitation. Someone who isn't in
// it gets its name, who runs it and one button to join, with the list they put in. A member
// gets the members, their own list, and after the draw the one name they drew, behind a button:
// the page is often opened with the others in the room.
//
// The server sends a member their own name of the draw and nobody else's, so nothing on this
// page, or in what Nuxt writes into the HTML, can show who drew whom. It needs a login: a
// group is between accounts.
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

const token = String(route.params.token)
const api = `/api/santa/${encodeURIComponent(token)}`
// An address no group has answers 404; the page then has nothing, and says so.
const { data, refresh } = await useFetch<SantaView>(api)
const group = computed(() => (data.value?.role === 'member' ? data.value : null))
const guest = computed(() => (data.value?.role === 'guest' ? data.value : null))

const guestTitle = computed(() => {
  if (!guest.value) return t('santa.goneTitle')
  return {
    open: t('santa.joinTitle', { name: guest.value.organiser, title: guest.value.title }),
    drawn: t('santa.drawnTitle'),
    full: t('santa.fullTitle'),
  }[guest.value.state]
})
const guestLead = computed(() => {
  if (!guest.value) return t('santa.goneLead')
  return {
    open: t('santa.joinLead'),
    drawn: t('santa.drawnLead', { title: guest.value.title }),
    full: t('santa.fullLead', { title: guest.value.title }),
  }[guest.value.state]
})

useHead({ title: () => group.value?.title ?? guestTitle.value })

// ── Joining ───────────────────────────────────────────────────────────────
const joinList = ref(startingList(guest.value?.mine))
const joining = ref(false)
const joinError = ref('')
const membersTitle = useTemplateRef<HTMLElement>('membersTitle')

async function join() {
  if (joining.value) return
  joining.value = true
  joinError.value = ''
  try {
    await $fetch<unknown>(`${api}/join`, { method: 'POST', body: { list: joinList.value } })
    await refresh()
    // The button went with the question; the members, with the person now among them, take the focus.
    await nextTick()
    membersTitle.value?.focus()
  }
  catch (error) {
    joinError.value = parse(error).message
    // The names were drawn, or the group filled up, since the page loaded: it then says so.
    await refresh()
  }
  finally {
    joining.value = false
  }
}

// ── The group, for a member ───────────────────────────────────────────────
const organiserName = computed(() => group.value?.members.find(member => member.organiser)?.name ?? '')
const enough = computed(() => (group.value?.members.length ?? 0) >= SANTA_MIN_MEMBERS)
const lead = computed(() => {
  if (!group.value) return ''
  if (group.value.drawn) return t('santa.secret')
  if (!group.value.organiser) return t('santa.drawWaits', { name: organiserName.value })
  return enough.value ? t('santa.organiserLead') : t('santa.drawNeeds', { n: SANTA_MIN_MEMBERS })
})

const memberMeta = (member: SantaMember) =>
  [member.organiser ? t('santa.organiser') : '', t(member.hasList ? 'santa.hasList' : 'santa.noListYet')].filter(Boolean).join(' · ')

// What a button did is said in a line that is always there: the button itself often goes.
const busy = ref(false)
const status = ref('')
const actionError = ref('')

async function act(request: () => Promise<unknown>, done: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  status.value = ''
  actionError.value = ''
  try {
    await request()
    status.value = done
    return true
  }
  catch (error) {
    actionError.value = parse(error).message
    return false
  }
  finally {
    // Also after a refusal: someone else joined, left or drew meanwhile.
    await refresh()
    busy.value = false
  }
}

/** The dialog's answer. Escape sets none, and browsers differ on whether it clears the last one. */
function answer(dialog: HTMLDialogElement | null): string {
  const choice = dialog?.returnValue ?? ''
  if (dialog) dialog.returnValue = ''
  return choice
}

// The link goes out through the same sheet a list is shared from.
const inviteSheet = useTemplateRef<{ open: (from?: HTMLElement | null) => void }>('inviteSheet')

// Renaming, for whoever runs the group: the title is the control, as on a list.
const renaming = ref(false)
const renameField = useTemplateRef<{ focus: (select?: boolean) => void }>('renameField')
const renameButton = useTemplateRef<HTMLButtonElement>('renameButton')

async function startRenaming() {
  renaming.value = true
  await nextTick()
  renameField.value?.focus(true)
}
async function rename(text: string, saved: string): Promise<string | null> {
  const title = cleanText(text, 'line')
  if (title === saved) return null
  try {
    await $fetch<unknown>(api, { method: 'PATCH', body: { title } })
    await refresh()
    return null
  }
  catch (error) {
    const parsed = parse(error)
    return parsed.fields.title ?? parsed.message
  }
}
async function onRenameDone(how: 'enter' | 'escape' | 'blur') {
  renaming.value = false
  // After leaving the field by clicking elsewhere, the focus is where that click put it.
  if (how === 'blur') return
  await nextTick()
  renameButton.value?.focus()
}

// Drawing the names. It asks first: it happens once, and closes the group.
const drawDialog = useTemplateRef<HTMLDialogElement>('drawDialog')
const pickTitle = useTemplateRef<HTMLElement>('pickTitle')

async function onDrawClose() {
  if (answer(drawDialog.value) !== 'draw') return
  if (!await act(() => $fetch<unknown>(`${api}/draw`, { method: 'POST' }), t('santa.drawDone'))) return
  await nextTick()
  pickTitle.value?.focus()
}

// The name the person drew stays behind a button until they ask for it.
const shown = ref(false)
const pickName = useTemplateRef<HTMLElement>('pickName')
async function reveal() {
  shown.value = true
  await nextTick()
  pickName.value?.focus()
}

// The list the person puts in: one press saves it.
const chosen = ref(group.value?.list ?? null)
const savingList = ref(false)
const listStatus = ref('')
const listError = ref('')
watch(() => group.value?.list, (list) => {
  if (!savingList.value) chosen.value = list ?? null
})

async function saveList(list: string | null) {
  if (savingList.value) return
  savingList.value = true
  chosen.value = list
  listStatus.value = ''
  listError.value = ''
  try {
    await $fetch<unknown>(`${api}/list`, { method: 'PUT', body: { list } })
    listStatus.value = t('santa.listSaved')
  }
  catch (error) {
    listError.value = parse(error).message
  }
  finally {
    await refresh()
    savingList.value = false
    // Not saved: the choice shows what the group still holds.
    chosen.value = group.value?.list ?? null
  }
}

// Taking someone out, before the draw. The dialog names the person, so it shows once that name is in it.
const removeDialog = useTemplateRef<HTMLDialogElement>('removeDialog')
const leaving = ref<SantaMember | null>(null)

async function askToRemove(member: SantaMember) {
  if (busy.value) return
  leaving.value = member
  await nextTick()
  removeDialog.value?.showModal()
}
async function onRemoveClose() {
  const member = leaving.value
  if (answer(removeDialog.value) !== 'remove' || !member) return
  await act(() => $fetch<unknown>(`${api}/members/${member.id}`, { method: 'DELETE' }), t('santa.removed', { name: member.name }))
  await nextTick()
  membersTitle.value?.focus()
}

// Leaving, and for whoever runs the group ending it. Both go back to the page of groups.
const endDialog = useTemplateRef<HTMLDialogElement>('endDialog')

async function onEndClose() {
  const how = answer(endDialog.value)
  if (how !== 'leave' && how !== 'delete') return
  const request = how === 'delete'
    ? () => $fetch<unknown>(api, { method: 'DELETE' })
    : () => $fetch<unknown>(`${api}/leave`, { method: 'POST' })
  busy.value = true
  actionError.value = ''
  try {
    await request()
    await navigateTo(localePath('/santa'))
  }
  catch (error) {
    actionError.value = parse(error).message
    await refresh()
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="group">
    <PageHead :title="group.title" :lead="lead">
      <template v-if="group.organiser" #title>
        <h1 v-if="!renaming">
          <button ref="renameButton" type="button" class="title-edit" aria-describedby="santa-rename-hint" @click="startRenaming">{{ group.title }}</button>
        </h1>
        <template v-else>
          <!-- The page keeps its heading while the visible title is a field. -->
          <h1 class="visually-hidden">{{ group.title }}</h1>
          <EditableText
            ref="renameField"
            class="title-edit-field"
            :value="group.title"
            :label="t('santa.name')"
            :save="rename"
            :maxlength="80"
            @done="onRenameDone"
          />
        </template>
        <span id="santa-rename-hint" class="visually-hidden">{{ t('santa.rename') }}</span>
      </template>
      <!-- Before the draw: the link to send on, and for whoever runs the group the draw itself.
           Afterwards there is nothing left to do up here. -->
      <template v-if="!group.drawn" #actions>
        <art-button v-if="group.organiser">
          <button type="button" :aria-disabled="!enough || busy || undefined" @click="enough && !busy && drawDialog?.showModal()">{{ t('santa.draw') }}</button>
        </art-button>
        <art-button variant="secondary">
          <button type="button" @click="inviteSheet?.open($event.currentTarget as HTMLElement)"><AppIcon name="share" />{{ t('santa.invite') }}</button>
        </art-button>
      </template>
    </PageHead>

    <section v-if="group.drawn" class="band section" data-paint="1" aria-labelledby="santa-pick-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="santa-pick-title" ref="pickTitle" class="section-title" tabindex="-1">{{ t('santa.pickTitle') }}</h2>
        </div>
        <div class="section-body">
          <div class="santa-pick">
            <p v-if="!group.pick">{{ t('santa.pickGone') }}</p>
            <template v-else-if="!shown">
              <p class="santa-pick-note">{{ t('santa.pickHidden') }}</p>
              <art-button>
                <button type="button" @click="reveal">{{ t('santa.reveal') }}</button>
              </art-button>
            </template>
            <template v-else>
              <div ref="pickName" class="santa-pick-card" tabindex="-1">
                <PersonPicture :person="group.pick" />
                <p class="santa-pick-who">
                  <span class="santa-pick-for">{{ t('santa.pickFor') }}</span>
                  <strong class="santa-pick-name">{{ group.pick.name }}</strong>
                </p>
              </div>
              <art-button v-if="group.pick.list">
                <NuxtLink :to="localePath(`/l/${group.pick.list.token}`)">{{ t('santa.pickList', { title: group.pick.list.title }) }}</NuxtLink>
              </art-button>
              <p v-else>{{ t('santa.pickNoList', { name: group.pick.name }) }}</p>
              <p class="santa-pick-note">{{ t('santa.pickAnonymous', { name: group.pick.name }) }}</p>
              <button type="button" class="word-button" @click="shown = false">{{ t('santa.hide') }}</button>
            </template>
          </div>
        </div>
      </div>
    </section>

    <section class="band section" :data-paint="group.drawn ? 2 : 1" aria-labelledby="santa-members-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="santa-members-title" ref="membersTitle" class="section-title" tabindex="-1">{{ t('santa.members') }}</h2>
        </div>
        <div class="section-body">
          <!-- Always there, so the words are announced when they appear. -->
          <p class="form-message" role="status">{{ status }}</p>
          <p v-if="actionError" class="form-message" role="alert">{{ actionError }}</p>
          <ul class="rows santa-members">
            <li v-for="member in group.members" :key="member.id" class="row">
              <PersonPicture :person="member" />
              <div :id="`santa-member-${member.id}`" class="row-text">
                <span class="row-title">{{ member.name }}<template v-if="member.you"> ({{ t('santa.you') }})</template></span>
                <span class="row-meta">{{ memberMeta(member) }}</span>
              </div>
              <art-button v-if="group.organiser && !group.drawn && !member.you" variant="quiet" size="s">
                <button type="button" :aria-describedby="`santa-member-${member.id}`" :aria-disabled="busy || undefined" @click="askToRemove(member)">{{ t('santa.remove') }}</button>
              </art-button>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="band section" :data-paint="group.drawn ? 3 : 2" aria-labelledby="santa-list-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="santa-list-title" class="section-title">{{ t('santa.yourList') }}</h2>
        </div>
        <div class="section-body">
          <SantaListChoice :model-value="chosen" :lists="group.lists" :legend="t('santa.listLegend')" :hint="t('santa.listHint')" @update:model-value="saveList" />
          <p class="form-message" role="status">{{ listStatus }}</p>
          <p v-if="listError" class="form-message" role="alert">{{ listError }}</p>
          <!-- Leaving is for before the draw; ending the group is for whoever runs it, at any time. -->
          <div v-if="group.organiser || !group.drawn" class="list-actions">
            <art-button variant="quiet" size="s">
              <button type="button" :aria-disabled="busy || undefined" @click="!busy && endDialog?.showModal()">{{ t(group.organiser ? 'santa.delete' : 'santa.leave') }}</button>
            </art-button>
          </div>
        </div>
      </div>
    </section>

    <ShareSheet v-if="!group.drawn" ref="inviteSheet" :title="t('santa.invite')" :note="t('santa.inviteNote')" :path="route.path" :text="t('santa.inviteShareText', { title: group.title })" />

    <dialog v-if="group.organiser && !group.drawn" ref="drawDialog" class="dialog" aria-labelledby="santa-draw-title" aria-describedby="santa-draw-text" @close="onDrawClose">
      <h2 id="santa-draw-title">{{ t('santa.drawTitle', { title: group.title }) }}</h2>
      <p id="santa-draw-text">
        {{ t('santa.drawBody', { n: group.members.length }) }}
        <template v-if="group.members.length === SANTA_MIN_MEMBERS">{{ ' ' + t('santa.drawBodyThree') }}</template>
      </p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('santa.cancel') }}</button>
        </art-button>
        <art-button>
          <button value="draw">{{ t('santa.drawConfirm') }}</button>
        </art-button>
      </form>
    </dialog>

    <dialog v-if="group.organiser && !group.drawn" ref="removeDialog" class="dialog" aria-labelledby="santa-remove-title" aria-describedby="santa-remove-text" @close="onRemoveClose">
      <h2 id="santa-remove-title">{{ t('santa.removeTitle', { name: leaving?.name ?? '' }) }}</h2>
      <p id="santa-remove-text">{{ t('santa.removeBody', { name: leaving?.name ?? '' }) }}</p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('santa.cancel') }}</button>
        </art-button>
        <art-button class="danger">
          <button value="remove">{{ t('santa.removeConfirm') }}</button>
        </art-button>
      </form>
    </dialog>

    <dialog v-if="group.organiser || !group.drawn" ref="endDialog" class="dialog" aria-labelledby="santa-end-title" aria-describedby="santa-end-text" @close="onEndClose">
      <h2 id="santa-end-title">{{ t(group.organiser ? 'santa.deleteTitle' : 'santa.leaveTitle', { title: group.title }) }}</h2>
      <p id="santa-end-text">
        <template v-if="group.organiser">
          {{ t('santa.deleteBody') }}
          <template v-if="group.drawn">{{ ' ' + t('santa.deleteBodyDrawn') }}</template>
        </template>
        <template v-else>{{ t('santa.leaveBody') }}</template>
      </p>
      <form method="dialog" class="actions">
        <art-button variant="secondary">
          <button value="cancel" autofocus>{{ t('santa.cancel') }}</button>
        </art-button>
        <art-button class="danger">
          <button :value="group.organiser ? 'delete' : 'leave'">{{ t(group.organiser ? 'santa.deleteConfirm' : 'santa.leaveConfirm') }}</button>
        </art-button>
      </form>
    </dialog>
  </div>

  <!-- Not in the group: the question, or why there is none to ask. -->
  <div v-else>
    <PageHead :title="guestTitle" :lead="guestLead">
      <template #actions>
        <art-button v-if="guest?.state !== 'open'" variant="secondary">
          <NuxtLink :to="localePath('/santa')">{{ t('santa.all') }}</NuxtLink>
        </art-button>
      </template>
    </PageHead>

    <section v-if="guest?.state === 'open'" class="band section" data-paint="1" aria-labelledby="santa-join-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="santa-join-title" class="section-title">{{ t('santa.join') }}</h2>
        </div>
        <div class="section-body">
          <form class="form" method="post" novalidate aria-labelledby="santa-join-title" @submit.prevent="join">
            <p>{{ t('santa.joinCount', { n: guest.members }, guest.members) }}</p>
            <SantaListChoice v-model="joinList" :lists="guest.mine.lists" :legend="t('santa.listLegend')" :hint="t('santa.listHint')" />
            <p v-if="joinError" class="form-message" role="alert">{{ joinError }}</p>
            <div class="actions">
              <art-button>
                <button type="submit" :aria-disabled="joining || undefined">{{ joining ? t('auth.busy') : t('santa.join') }}</button>
              </art-button>
              <art-button variant="quiet">
                <NuxtLink :to="localePath('/')">{{ t('santa.later') }}</NuxtLink>
              </art-button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <section v-if="guest?.state === 'open'" class="band section" data-paint="2" aria-labelledby="santa-how-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="santa-how-title" class="section-title">{{ t('santa.howTitle') }}</h2>
        </div>
        <div class="section-body">
          <ul class="rows">
            <li v-for="n in 3" :key="n" class="row">{{ t(`santa.how${n}`) }}</li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>
