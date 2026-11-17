<script setup lang="ts">
import type { ListTarget } from '#shared/schemas/input'
import type { InviteView } from '#shared/schemas/list'

// The page a link that works once opens. Someone who isn't logged in logs in first and comes
// back here. Open, it shows what the link shares and takes it in one press: wishes onto a list
// of the person's choosing, or the person into the list as a co-owner. Afterwards they are on
// that list. A link that is spent, or the person's own, says so in a sentence.
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const { parse } = useApiError()

const token = computed(() => String(route.params.token))
const { data, error } = await useFetch<InviteView>(() => `/api/invites/${encodeURIComponent(token.value)}`)
if (error.value || !data.value) {
  throw createError({ statusCode: error.value?.statusCode ?? 404, fatal: true })
}
const invite = computed(() => data.value!)

// Someone else took the link between opening and pressing: from then on it reads as spent.
const closedNow = ref(false)
const state = computed(() => (closedNow.value ? 'closed' : invite.value.state))

const title = computed(() => {
  if (state.value !== 'open') return t('invite.title')
  const { kind, from, listTitle, wishes } = invite.value
  return kind === 'list' ? t('invite.list', { from, title: listTitle }) : t('invite.wishes', { from, n: wishes.length }, wishes.length)
})
const lead = computed(() => {
  if (state.value === 'closed') return t('invite.closed', { from: invite.value.from })
  if (state.value === 'own') return t('invite.own')
  return null
})
useHead({ title })

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

async function accept() {
  if (busy.value || alreadyOwner.value) return
  const { kind } = invite.value
  if (kind === 'wishes' && !target.value) {
    nameError.value = t('fields.required')
    chooser.value?.focus()
    return
  }
  busy.value = true
  message.value = ''
  try {
    const body = kind === 'wishes' ? target.value : {}
    const accepted = await $fetch<{ token: string }>(`/api/invites/${encodeURIComponent(token.value)}/accept`, { method: 'POST', body })
    await navigateTo(localePath(`/l/${accepted.token}`))
  }
  catch (error) {
    const parsed = parse(error)
    // Spent meanwhile, or dropped for newer links of its list: the same sentence as a spent one.
    if (parsed.code === 'invite_closed' || parsed.code === 'not_found') {
      closedNow.value = true
      await nextTick()
      pageTitle.value?.focus()
    }
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
             after the link turned out to be spent. -->
        <h1 ref="pageTitle" tabindex="-1" :aria-describedby="lead ? 'invite-state' : undefined">{{ title }}</h1>
        <p v-if="lead" id="invite-state" class="lead">{{ lead }}</p>
      </template>
    </PageHead>
    <section class="band section invite" data-paint="1">
      <div class="inner">
        <div v-if="state === 'open'" class="invite-body">
          <ul v-if="invite.kind === 'wishes'" class="rows invite-wishes">
            <li v-for="wish in invite.wishes" :key="wish.id" class="row">
              <WishThumb :wish="wish" />
              <span class="row-title">{{ wish.title }}</span>
            </li>
          </ul>
          <p class="invite-lead">
            {{ invite.kind === 'list' ? t('invite.listLead') : t('invite.wishesLead', invite.wishes.length) }}
          </p>
          <ListChooser
            v-if="invite.kind === 'wishes'"
            ref="chooser"
            v-model="target"
            :lists="invite.mine.lists"
            :last="invite.mine.last"
            :legend="t('add.which')"
            :error="nameError"
          />
          <div class="actions">
            <art-button>
              <button type="button" :aria-disabled="busy || alreadyOwner || undefined" @click="accept">
                {{ invite.kind === 'list' ? t('invite.acceptList') : t('invite.accept') }}
              </button>
            </art-button>
          </div>
          <p v-if="alreadyOwner" class="form-message" role="alert">
            {{ t('invite.alreadyOwner') }} <NuxtLink :to="localePath('/')">{{ t('error.home') }}</NuxtLink>
          </p>
          <p v-if="message" class="form-message" role="alert">{{ message }}</p>
        </div>
        <p v-else>
          <NuxtLink :to="localePath('/')">{{ t('error.home') }}</NuxtLink>
        </p>
      </div>
    </section>
  </div>
</template>
