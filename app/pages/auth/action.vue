<script setup lang="ts">
import type { MailLink } from '#shared/schemas/mail-link'

// Where the links in Firebase's mails lead, once the project's action URL points here
// (docs/deploying.md): a new password, an address to confirm, a new address, and the old address
// back. Firebase adds what the link is for (`mode`), its one-time code (`oobCode`) and the
// language the mail was asked in (`lang`).
//
// Opening the page only reads the code. What the link is for happens on the button, so a mail
// program that opens links to look at them changes nothing.
const route = useRoute()
const { t, locale } = useI18n()
const localePath = useLocalePath()
// Someone who is logged in has the site's menu; only someone who isn't is shown the way in.
const { loggedIn } = useUserSession()

const param = (name: string) => {
  const value = route.query[name]
  return typeof value === 'string' ? value : ''
}
const code = param('oobCode')

// Firebase has one address for every language, so the mail's language picks the page's.
if (param('lang').toLowerCase().startsWith('en') && locale.value !== 'en') {
  await navigateTo({ path: localePath('/auth/action', 'en'), query: route.query }, { replace: true })
}

const { data } = await useAsyncData('mail-link', () => $fetch<{ link: MailLink | null }>('/api/auth/mail-link', { query: { code } }))
const link = computed(() => data.value?.link ?? null)
// What a link that no longer works was for, as far as its address says.
const wasReset = param('mode') === 'resetPassword'

const password = ref('')
const done = ref<MailLink | null>(null)

const { form, pending, message, errors, run } = useForm(async () => {
  const reset = link.value?.kind === 'reset_password'
  const answer = await $fetch<{ link: MailLink, loggedIn: boolean }>('/api/auth/mail-link', {
    method: 'POST',
    body: { code, ...(reset ? { newPassword: password.value } : {}) },
  })
  // The new password logged them in. A full page load: everything on screen is then rendered
  // for that person, and this page's code is used up anyway.
  if (answer.loggedIn) return window.location.assign(localePath('/'))
  done.value = answer.link
})

const KEYS = { reset_password: 'reset', verify_email: 'verify', change_email: 'change', recover_email: 'recover' } as const
const shown = computed(() => done.value ?? link.value)
const key = computed(() => (shown.value ? KEYS[shown.value.kind] : null))

const title = computed(() => (key.value ? t(`mailLink.${key.value}Title`) : t('mailLink.goneTitle')))
const lead = computed(() => {
  const about = link.value
  if (!about || !key.value || done.value) return null
  return about.previous && about.kind !== 'reset_password' && about.kind !== 'verify_email'
    ? t(`mailLink.${key.value}LeadFrom`, { email: about.email, previous: about.previous })
    : t(`mailLink.${key.value}Lead`, { email: about.email })
})
const action = computed(() => {
  if (link.value?.kind === 'reset_password') return t('mailLink.resetSave')
  return key.value ? t(`mailLink.${key.value}Confirm`) : ''
})
const doneText = computed(() => (done.value && key.value ? t(`mailLink.${key.value}Done`, { email: done.value.email }) : ''))

useHead({ title })
</script>

<template>
  <div>
    <PageHead :title="title" :lead="lead" />
    <section class="band wide" data-paint="1">
      <div class="inner">
        <div class="form">
          <!-- Always there, so a screen reader hears it fill in. -->
          <p class="form-message" role="status">{{ doneText }}</p>

          <template v-if="done">
            <p v-if="done.kind === 'recover_email'">
              <NuxtLink :to="{ path: localePath('/forgot'), query: { email: done.email } }">{{ t('mailLink.recoverReset') }}</NuxtLink>
            </p>
            <p v-if="!loggedIn"><NuxtLink :to="localePath('/login')">{{ t('mailLink.toLogin') }}</NuxtLink></p>
          </template>

          <template v-else-if="!link">
            <p class="form-message" role="alert">{{ t('mailLink.gone') }}</p>
            <p v-if="wasReset"><NuxtLink :to="localePath('/forgot')">{{ t('mailLink.goneReset') }}</NuxtLink></p>
            <p v-if="!loggedIn"><NuxtLink :to="localePath('/login')">{{ t('mailLink.toLogin') }}</NuxtLink></p>
          </template>

          <form v-else ref="form" class="form" method="post" novalidate @submit.prevent="run">
            <p v-if="message" class="form-message" role="alert">{{ message }}</p>
            <template v-if="link.kind === 'reset_password'">
              <!-- Lets a password manager save the password under the right account. -->
              <input type="email" name="email" autocomplete="username" :value="link.email" hidden readonly>
              <PasswordField
                id="new-password"
                v-model="password"
                :label="t('settings.newPassword')"
                autocomplete="new-password"
                :hint="t('auth.passwordHint')"
                :minlength="8"
                :error="errors.newPassword"
              />
            </template>
            <div class="actions">
              <art-button>
                <button type="submit" :aria-disabled="pending || undefined">{{ pending ? t('auth.busy') : action }}</button>
              </art-button>
            </div>
          </form>
        </div>
      </div>
    </section>
  </div>
</template>
