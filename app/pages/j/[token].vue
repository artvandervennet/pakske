<script setup lang="ts">
import type { ListTarget } from '#shared/schemas/input'
import type { InviteView } from '#shared/schemas/list'

// The page a share link opens. Someone who isn't logged in logs in first and comes back here.
// A link for wishes shows them with a box each, all ticked: the person unticks what they don't
// want, chooses one of their lists and takes the rest in one press, as copies or as wishes they
// then share, whichever the link's maker chose. A link for a list makes the person a co-owner.
// Afterwards they are on that list. A link that can't be used says why in a sentence.
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

const token = computed(() => String(route.params.token))
const address = computed(() => `/api/invites/${encodeURIComponent(token.value)}`)
const { data, error } = await useFetch<InviteView>(address)
if (error.value || !data.value) {
  throw createError({ statusCode: error.value?.statusCode ?? 404, fatal: true })
}
// A copy of its own, so the page can fetch the link again without the first answer's errors
// taking the page away.
const invite = ref<InviteView>(data.value)
watch(data, (fresh) => {
  if (fresh) invite.value = fresh
})

// The link was dropped for newer ones of its list between opening and pressing: it reads as closed.
const goneNow = ref(false)
const state = computed(() => (goneNow.value ? 'closed' : invite.value.state))

const title = computed(() => {
  const { kind, from, listTitle, wishes, yours } = invite.value
  if (state.value !== 'open') return yours ? t('invite.ownTitle') : t('invite.title', { from })
  return kind === 'list' ? t('invite.list', { from, title: listTitle }) : t('invite.wishes', { from, n: wishes.length }, wishes.length)
})
const lead = computed(() => {
  const { from, yours } = invite.value
  // The maker can't ask themselves for a new link.
  const next = yours ? t('invite.makeNew') : t('invite.askNew', { from })
  if (state.value === 'closed') return `${t('invite.closed')} ${next}`
  if (state.value === 'expired') return `${t('invite.expired')} ${next}`
  if (state.value === 'used') return t('invite.used')
  if (state.value === 'own') return t('invite.own')
  return null
})
useHead({ title })

/** What taking the wishes means, which depends on how the maker shared them. */
const explain = computed(() => {
  const { mode, from, wishes } = invite.value
  return mode === 'copy' ? t('invite.copyLead', { from }, wishes.length) : t('invite.linkedLead', wishes.length)
})

// Sharing a wish the person already owns would change nothing, so its box is off and can't be
// ticked. A copy of it is still a new wish, so a copy link leaves every box free.
const locked = (wish: InviteView['wishes'][number]) => invite.value.mode === 'linked' && wish.owned
const takeable = computed(() => invite.value.wishes.filter(wish => !locked(wish)))
const ticked = reactive(new Set(takeable.value.map(wish => wish.id)))
const chosen = computed(() => takeable.value.filter(wish => ticked.has(wish.id)).map(wish => wish.id))
const allTicked = computed(() => chosen.value.length === takeable.value.length)

function tick(id: number, on: boolean) {
  if (on) ticked.add(id)
  else ticked.delete(id)
}

function tickAll(on: boolean) {
  ticked.clear()
  if (on) for (const wish of takeable.value) ticked.add(wish.id)
}

const target = ref<ListTarget | null>(null)
const nameError = ref('')
const message = ref('')
// An owner of the list who opens a link to it: there is nothing to join.
const alreadyOwner = ref(false)
const busy = ref(false)
const chooser = useTemplateRef<{ focus: () => void }>('chooser')
const pageTitle = useTemplateRef<HTMLElement>('pageTitle')

// A name typed for a new list clears what was said about the empty one.
watch(target, () => (nameError.value = ''))

/**
 * The link was refused as closed or changed: fetches it again, so the page says what it is now.
 * Still open means one of the ticked wishes left the list; the ticks keep what is still there
 * and the person is asked to look again. When nothing is left to take, the button they pressed
 * is gone, and the focus goes to the heading.
 */
async function reload() {
  try {
    invite.value = await $fetch<InviteView>(address.value)
  }
  catch {
    goneNow.value = true
  }
  for (const id of [...ticked]) {
    if (!takeable.value.some(wish => wish.id === id)) ticked.delete(id)
  }
  if (state.value === 'open' && takeable.value.length) {
    message.value = t('invite.changed')
    return
  }
  await nextTick()
  pageTitle.value?.focus()
}

async function accept() {
  if (busy.value || alreadyOwner.value) return
  const { kind } = invite.value
  if (kind === 'wishes') {
    if (!chosen.value.length) return
    if (!target.value) {
      nameError.value = t('fields.required')
      chooser.value?.focus()
      return
    }
  }
  busy.value = true
  message.value = ''
  try {
    const body = kind === 'wishes' ? { ...target.value, wishIds: chosen.value } : {}
    const accepted = await $fetch<{ token: string }>(`${address.value}/accept`, { method: 'POST', body })
    await navigateTo(localePath(`/l/${accepted.token}`))
  }
  catch (failure) {
    const parsed = parse(failure)
    if (parsed.code === 'invite_closed' || parsed.code === 'not_found') await reload()
    else if (parsed.code === 'forbidden' && kind === 'list') alreadyOwner.value = true
    else if (parsed.fields.newList) {
      nameError.value = parsed.fields.newList
      chooser.value?.focus()
    }
    else message.value = parsed.message
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <PageHead :title="title">
      <template #title>
        <!-- The sentence is the heading's description, so it is read when the focus comes here
             after the link turned out to be closed. -->
        <h1 ref="pageTitle" tabindex="-1" :aria-describedby="lead ? 'invite-state' : undefined">{{ title }}</h1>
        <p v-if="lead" id="invite-state" class="lead">{{ lead }}</p>
      </template>
    </PageHead>
    <section class="band section invite" data-paint="1">
      <div class="inner">
        <div v-if="state === 'open'" class="invite-body">
          <template v-if="invite.kind === 'wishes'">
            <p class="invite-lead">{{ explain }}</p>
            <fieldset class="invite-pick">
              <legend class="invite-pick-legend">{{ t('invite.pick') }}</legend>
              <art-button v-if="invite.wishes.length > 5 && takeable.length" variant="quiet" size="s">
                <button type="button" @click="tickAll(!allTicked)">{{ allTicked ? t('invite.tickNone') : t('invite.tickAll') }}</button>
              </art-button>
              <ul class="rows invite-wishes">
                <li v-for="wish in invite.wishes" :key="wish.id">
                  <label class="row invite-wish">
                    <span class="tick-box">
                      <input
                        type="checkbox"
                        :checked="ticked.has(wish.id)"
                        :disabled="locked(wish)"
                        @change="event => tick(wish.id, (event.target as HTMLInputElement).checked)"
                      >
                    </span>
                    <WishThumb :wish="wish" />
                    <span class="row-text">
                      <span class="row-title">{{ wish.title }}</span>
                      <span v-if="locked(wish)" class="row-meta">{{ t('invite.owned') }}</span>
                    </span>
                  </label>
                </li>
              </ul>
            </fieldset>
            <template v-if="takeable.length">
              <ListChooser
                ref="chooser"
                v-model="target"
                :lists="invite.mine.lists"
                :last="invite.mine.last"
                :legend="t('add.which')"
                :error="nameError"
              />
              <div class="actions">
                <art-button>
                  <button
                    type="button"
                    :aria-disabled="busy || !chosen.length || undefined"
                    :aria-describedby="chosen.length ? undefined : 'invite-nothing'"
                    @click="accept"
                  >
                    {{ t('invite.accept') }}
                  </button>
                </art-button>
              </div>
              <p v-if="!chosen.length" id="invite-nothing" class="invite-hint">{{ t('invite.nothing') }}</p>
            </template>
            <p v-else>
              {{ t('invite.allOwned', invite.wishes.length) }} <NuxtLink :to="localePath('/')">{{ t('error.home') }}</NuxtLink>
            </p>
          </template>
          <template v-else>
            <p class="invite-lead">{{ t('invite.listLead') }}</p>
            <div class="actions">
              <art-button>
                <button type="button" :aria-disabled="busy || alreadyOwner || undefined" @click="accept">{{ t('invite.acceptList') }}</button>
              </art-button>
            </div>
            <p v-if="alreadyOwner" class="form-message" role="alert">
              {{ t('invite.alreadyOwner') }} <NuxtLink :to="localePath('/')">{{ t('error.home') }}</NuxtLink>
            </p>
          </template>
          <p v-if="message" class="form-message" role="alert">{{ message }}</p>
        </div>
        <p v-else>
          <NuxtLink :to="localePath('/')">{{ t('error.home') }}</NuxtLink>
        </p>
      </div>
    </section>
  </div>
</template>
