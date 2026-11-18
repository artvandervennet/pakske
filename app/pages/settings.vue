<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { t } = useI18n()
const localePath = useLocalePath()
const { fetch: refreshSession } = useUserSession()

useHead({ title: () => t('settings.title') })

const { data: me, refresh: refreshMe } = await useFetch('/api/me')
// Google's section only where the site offers it, or for an account that already uses it.
const { data: options } = await useFetch('/api/auth/options', { key: 'auth-options' })
const route = useRoute()
const { te } = useI18n()
const { parse } = useApiError()

const displayName = ref(me.value?.displayName ?? '')
const profileSaved = ref('')

const profile = useForm(async () => {
  profileSaved.value = ''
  await $fetch('/api/me', { method: 'PATCH', body: { displayName: displayName.value } })
  await refreshSession()
  profileSaved.value = t('settings.saved')
})

const currentPassword = ref('')
const newPassword = ref('')
const passwordSaved = ref('')

// An account made with Google has no password: Firebase mails it a link to choose one.
const hasPassword = computed(() => me.value?.hasPassword !== false)

const password = useForm(async () => {
  passwordSaved.value = ''
  await $fetch('/api/me/password', { method: 'PUT', body: { currentPassword: currentPassword.value, newPassword: newPassword.value } })
  currentPassword.value = ''
  newPassword.value = ''
  passwordSaved.value = t('settings.passwordSaved')
})

const { locale } = useI18n()
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
</script>

<template>
  <div>
    <PageHead :title="t('settings.title')" />

    <section class="band section" data-paint="1" aria-labelledby="profile-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="profile-title" class="section-title">{{ t('settings.profileTitle') }}</h2>
          <p class="intro">{{ t('settings.profileIntro') }}</p>
        </div>
        <div class="section-body">
          <form :ref="profile.form" class="form" method="post" novalidate aria-labelledby="profile-title" @submit.prevent="profile.run">
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
        </div>
      </div>
    </section>

    <section v-if="options?.google || me?.google" class="band section" data-paint="2" aria-labelledby="google-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="google-title" class="section-title">{{ t('settings.googleTitle') }}</h2>
          <p class="intro">{{ t('settings.googleIntro') }}</p>
        </div>
        <div class="section-body google-settings">
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
      </div>
    </section>

    <section class="band section" data-paint="1" aria-labelledby="password-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="password-title" class="section-title">{{ hasPassword ? t('settings.passwordTitle') : t('settings.passwordSetTitle') }}</h2>
          <p class="intro">{{ hasPassword ? t('settings.passwordIntro') : t('settings.passwordSetIntro') }}</p>
        </div>
        <div class="section-body">
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
        </div>
      </div>
    </section>
  </div>
</template>
