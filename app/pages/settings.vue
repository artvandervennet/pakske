<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { t, te, locale } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { fetch: refreshSession } = useUserSession()
const { parse } = useApiError()

useHead({ title: () => t('settings.title') })

const { data: me, refresh: refreshMe } = await useFetch('/api/me')
// Google's section only where the site offers it, or for an account that already uses it.
const { data: options } = await useFetch('/api/auth/options', { key: 'auth-options' })

// An account made with Google has no password: Firebase mails it a link to choose one. The
// other forms then don't ask for one either.
const hasPassword = computed(() => me.value?.hasPassword !== false)

const displayName = ref(me.value?.displayName ?? '')
const profileSaved = ref('')

const profile = useForm(async () => {
  profileSaved.value = ''
  await $fetch('/api/me', { method: 'PATCH', body: { displayName: displayName.value } })
  await refreshSession()
  profileSaved.value = t('settings.saved')
})

// Another address: Firebase mails the new one a link, and nothing changes before that link is
// clicked. Until then this page keeps showing the address the account has.
const newEmail = ref('')
const emailPassword = ref('')
const emailSent = ref('')
const emailTaken = ref(false)

const emailChange = useForm(async () => {
  emailSent.value = ''
  emailTaken.value = false
  const email = newEmail.value.trim()
  try {
    await $fetch('/api/me/email', {
      method: 'POST',
      body: { email, locale: locale.value, ...(hasPassword.value ? { currentPassword: emailPassword.value } : {}) },
    })
  }
  catch (error) {
    // The sentence for a taken address tells someone registering to log in; here they are.
    emailTaken.value = parse(error).code === 'email_taken'
    throw error
  }
  newEmail.value = ''
  emailPassword.value = ''
  emailSent.value = t('settings.emailSent', { email })
})

const currentPassword = ref('')
const newPassword = ref('')
const passwordSaved = ref('')

const password = useForm(async () => {
  passwordSaved.value = ''
  await $fetch('/api/me/password', { method: 'PUT', body: { currentPassword: currentPassword.value, newPassword: newPassword.value } })
  currentPassword.value = ''
  newPassword.value = ''
  passwordSaved.value = t('settings.passwordSaved')
})

const mailSent = ref('')
const passwordMail = useForm(async () => {
  mailSent.value = ''
  await $fetch('/api/me/password-mail', { method: 'POST', body: { locale: locale.value } })
  mailSent.value = t('settings.passwordMailSent', { email: me.value?.email ?? '' })
})

// Back from Google after linking: that it worked, or why not (server/routes/auth/google.get.ts).
const googleBack = route.query.google
const googleSaved = ref(googleBack === 'linked' ? t('settings.googleLinked') : '')
const googleMessage = ref(typeof googleBack === 'string' && googleBack !== 'linked' && te(`errors.${googleBack}`) ? t(`errors.${googleBack}`) : '')
const unlinking = ref(false)

async function unlinkGoogle() {
  if (unlinking.value) return
  unlinking.value = true
  googleSaved.value = ''
  googleMessage.value = ''
  try {
    await $fetch('/api/me/google', { method: 'DELETE' })
    await refreshMe()
    googleSaved.value = t('settings.googleUnlinked')
  }
  catch (error) {
    googleMessage.value = parse(error).message
  }
  finally {
    unlinking.value = false
  }
}

// Giving without your name by default. It saves at once, like the same switch on a wish.
const anonymousDefault = ref(me.value?.anonymousDefault ?? false)
const givingBusy = ref(false)
const givingSaved = ref('')
const givingMessage = ref('')

async function onAnonymousDefault(event: Event) {
  const input = event.target as HTMLInputElement
  const anonymous = input.checked
  if (givingBusy.value) {
    input.checked = !anonymous
    return
  }
  givingBusy.value = true
  givingSaved.value = ''
  givingMessage.value = ''
  try {
    await $fetch('/api/me', { method: 'PATCH', body: { anonymousDefault: anonymous } })
    anonymousDefault.value = anonymous
    // The switch on a wish shows what the session says (useBuyAnonymously); a tick itself
    // leaves it to the server, which reads the account.
    await refreshSession()
    givingSaved.value = t(anonymous ? 'settings.anonymousOn' : 'settings.anonymousOff')
  }
  catch (error) {
    input.checked = !anonymous
    givingMessage.value = parse(error).message
  }
  finally {
    givingBusy.value = false
  }
}

// Deleting the account, behind a dialog that says what goes and asks for the password.
const deleteDialog = useTemplateRef<HTMLDialogElement>('deleteDialog')
const deletePassword = ref('')

const removal = useForm(async () => {
  await $fetch('/api/me', { method: 'DELETE', body: hasPassword.value ? { currentPassword: deletePassword.value } : {} })
  // A full page load, as after logging out: nothing of the account stays in memory.
  window.location.assign(localePath('/'))
})

function openDelete() {
  deletePassword.value = ''
  removal.message.value = ''
  removal.errors.value = {}
  deleteDialog.value?.showModal()
  // Cancel has the focus, and on a small screen the browser scrolls it into view: past what
  // goes and what stays. The dialog opens where that starts.
  deleteDialog.value?.scrollTo(0, 0)
}
</script>

<template>
  <div>
    <PageHead :title="t('settings.title')" />

    <div class="band wide" data-paint="1">
      <div class="inner">
        <div class="settings">
          <section class="settings-section" aria-labelledby="profile-title">
            <h2 id="profile-title" class="settings-heading">{{ t('settings.profileTitle') }}</h2>
            <form :ref="profile.form" class="form" method="post" novalidate :aria-label="t('settings.displayName')" @submit.prevent="profile.run">
              <p v-if="profile.message.value" class="form-message" role="alert">{{ profile.message.value }}</p>
              <FormField id="name" v-slot="field" :label="t('settings.displayName')" :error="profile.errors.value.displayName">
                <input
                  id="name"
                  v-model="displayName"
                  name="name"
                  type="text"
                  autocomplete="name"
                  maxlength="60"
                  required
                  :aria-describedby="field.describedBy"
                  :aria-invalid="field.invalid"
                >
              </FormField>
              <div class="actions">
                <art-button>
                  <button type="submit" :disabled="profile.pending.value">{{ t('settings.save') }}</button>
                </art-button>
              </div>
              <p class="form-message" role="status">{{ profileSaved }}</p>
            </form>

            <form :ref="emailChange.form" class="form" method="post" novalidate :aria-label="t('settings.email')" @submit.prevent="emailChange.run">
              <p class="settings-current">
                <span class="settings-current-label">{{ t('settings.email') }}</span>
                <span class="settings-current-value">{{ me?.email }}</span>
              </p>
              <p v-if="emailChange.message.value" class="form-message" role="alert">{{ emailTaken ? t('settings.emailTaken') : emailChange.message.value }}</p>
              <!-- Tells a password manager whose password the field below asks for. -->
              <input v-if="hasPassword" type="email" name="email" autocomplete="username" :value="me?.email" hidden readonly>
              <FormField id="new-email" v-slot="field" :label="t('settings.newEmail')" :hint="t('settings.newEmailHint')" :error="emailChange.errors.value.email">
                <input
                  id="new-email"
                  v-model="newEmail"
                  name="new-email"
                  type="email"
                  autocomplete="email"
                  autocapitalize="none"
                  spellcheck="false"
                  maxlength="254"
                  required
                  :aria-describedby="field.describedBy"
                  :aria-invalid="field.invalid"
                >
              </FormField>
              <PasswordField v-if="hasPassword" id="email-current-password" v-model="emailPassword" :label="t('settings.currentPassword')" autocomplete="current-password" :error="emailChange.errors.value.currentPassword" />
              <div class="actions">
                <art-button>
                  <button type="submit" :disabled="emailChange.pending.value">{{ t('settings.changeEmail') }}</button>
                </art-button>
              </div>
              <p class="form-message" role="status">{{ emailSent }}</p>
            </form>
          </section>

          <section class="settings-section" aria-labelledby="password-title">
            <div class="settings-head">
              <h2 id="password-title" class="settings-heading">{{ hasPassword ? t('settings.passwordTitle') : t('settings.passwordSetTitle') }}</h2>
              <p class="settings-intro">{{ hasPassword ? t('settings.passwordIntro') : t('settings.passwordSetIntro') }}</p>
            </div>
            <form v-if="hasPassword" :ref="password.form" class="form" method="post" novalidate aria-labelledby="password-title" @submit.prevent="password.run">
              <p v-if="password.message.value" class="form-message" role="alert">{{ password.message.value }}</p>
              <!-- Lets a password manager tie the new password to the right account. -->
              <input type="email" name="email" autocomplete="username" :value="me?.email" hidden readonly>
              <PasswordField id="current-password" v-model="currentPassword" :label="t('settings.currentPassword')" autocomplete="current-password" :error="password.errors.value.currentPassword" />
              <PasswordField id="new-password" v-model="newPassword" :label="t('settings.newPassword')" :hint="t('auth.passwordHint')" autocomplete="new-password" :minlength="8" :error="password.errors.value.newPassword" />
              <div class="actions">
                <art-button>
                  <button type="submit" :disabled="password.pending.value">{{ t('settings.changePassword') }}</button>
                </art-button>
                <NuxtLink class="actions-link" :to="localePath('/forgot')">{{ t('auth.forgotLink') }}</NuxtLink>
              </div>
              <p class="form-message" role="status">{{ passwordSaved }}</p>
            </form>
            <form v-else :ref="passwordMail.form" class="form" method="post" novalidate aria-labelledby="password-title" @submit.prevent="passwordMail.run">
              <p v-if="passwordMail.message.value" class="form-message" role="alert">{{ passwordMail.message.value }}</p>
              <div class="actions">
                <art-button>
                  <button type="submit" :disabled="passwordMail.pending.value">{{ t('settings.passwordMail') }}</button>
                </art-button>
              </div>
              <p class="form-message" role="status">{{ mailSent }}</p>
            </form>
          </section>

          <section v-if="options?.google || me?.google" class="settings-section" aria-labelledby="google-title">
            <div class="settings-head">
              <h2 id="google-title" class="settings-heading">{{ t('settings.googleTitle') }}</h2>
              <p class="settings-intro">{{ t('settings.googleIntro') }}</p>
            </div>
            <div class="google-settings">
              <p v-if="googleMessage" class="form-message" role="alert">{{ googleMessage }}</p>
              <template v-if="me?.google">
                <p>{{ t('settings.googleOn') }}</p>
                <art-button v-if="me.hasPassword" variant="secondary">
                  <button type="button" :disabled="unlinking" @click="unlinkGoogle">{{ t('settings.googleUnlink') }}</button>
                </art-button>
              </template>
              <GoogleLogin v-else :from="route.path" link :label="t('settings.googleLink')" />
              <p class="form-message" role="status">{{ googleSaved }}</p>
            </div>
          </section>

          <section class="settings-section" aria-labelledby="giving-title">
            <h2 id="giving-title" class="settings-heading">{{ t('settings.givingTitle') }}</h2>
            <!-- The same switch, in the same words, as "Anoniem geven" on a wish. -->
            <div class="switch-field">
              <label class="switch">
                <input
                  type="checkbox"
                  role="switch"
                  :checked="anonymousDefault"
                  :aria-busy="givingBusy || undefined"
                  aria-describedby="anonymous-default-hint"
                  @change="onAnonymousDefault"
                >
                {{ t('settings.anonymousDefault') }}
              </label>
              <p id="anonymous-default-hint" class="switch-hint">{{ t('settings.anonymousDefaultHint') }}</p>
            </div>
            <p v-if="givingMessage" class="form-message" role="alert">{{ givingMessage }}</p>
            <p class="form-message" role="status">{{ givingSaved }}</p>
          </section>

          <section class="settings-section" aria-labelledby="appearance-title">
            <div class="settings-head">
              <h2 id="appearance-title" class="settings-heading">{{ t('settings.appearanceTitle') }}</h2>
              <p id="appearance-intro" class="settings-intro">{{ t('settings.appearanceIntro') }}</p>
            </div>
            <SchemeChoice labelledby="appearance-title" describedby="appearance-intro" />
          </section>

          <section class="settings-section" aria-labelledby="delete-title">
            <div class="settings-head">
              <h2 id="delete-title" class="settings-heading">{{ t('settings.deleteTitle') }}</h2>
              <p class="settings-intro">{{ t('settings.deleteIntro') }}</p>
            </div>
            <div class="actions settings-quiet-action">
              <art-button variant="quiet" class="danger">
                <button type="button" @click="openDelete">{{ t('settings.deleteOpen') }}</button>
              </art-button>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- Cancel has the focus, so Enter or a stray tap deletes nothing; the password field's own
         Enter does submit, as in any form. -->
    <dialog ref="deleteDialog" class="dialog" aria-labelledby="delete-dialog-title">
      <h2 id="delete-dialog-title">{{ t('settings.deleteDialogTitle') }}</h2>
      <p>{{ t('settings.deleteGone') }}</p>
      <ul class="settings-gone">
        <li>{{ t('settings.deleteLogin') }}</li>
        <li>{{ t('settings.deleteGiving') }}</li>
      </ul>
      <p>{{ t('settings.deleteStays') }}</p>
      <ul class="settings-gone">
        <li>{{ t('settings.deleteLists') }}</li>
        <li>{{ t('settings.deleteNotes') }}</li>
      </ul>
      <p>{{ t('settings.deleteAgain') }}</p>
      <form :ref="removal.form" class="form" method="post" novalidate aria-labelledby="delete-dialog-title" @submit.prevent="removal.run">
        <p v-if="removal.message.value" class="form-message" role="alert">{{ removal.message.value }}</p>
        <template v-if="hasPassword">
          <!-- Lets a password manager offer the password of the right account. -->
          <input type="email" name="email" autocomplete="username" :value="me?.email" hidden readonly>
          <PasswordField id="delete-current-password" v-model="deletePassword" :label="t('settings.currentPassword')" autocomplete="current-password" :error="removal.errors.value.currentPassword" />
        </template>
        <div class="actions">
          <art-button variant="secondary">
            <button type="button" autofocus @click="deleteDialog?.close()">{{ t('settings.deleteCancel') }}</button>
          </art-button>
          <art-button class="danger">
            <button type="submit" :disabled="removal.pending.value">{{ t('settings.deleteConfirm') }}</button>
          </art-button>
        </div>
      </form>
    </dialog>
  </div>
</template>
