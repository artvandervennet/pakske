<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { t } = useI18n()
const { fetch: refreshSession } = useUserSession()

useHead({ title: () => t('settings.title') })

const { data: me } = await useFetch('/api/me')

const displayName = ref(me.value?.displayName ?? '')
const listIntro = ref(me.value?.listIntro ?? '')
const profileSaved = ref('')

const profile = useForm(async () => {
  profileSaved.value = ''
  await $fetch('/api/me', { method: 'PATCH', body: { displayName: displayName.value, listIntro: listIntro.value } })
  await refreshSession()
  profileSaved.value = t('settings.saved')
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
            <FormField id="intro" v-slot="field" :label="t('settings.listIntro')" :hint="t('settings.listIntroHint')" :error="profile.errors.value.listIntro">
              <textarea
                id="intro"
                v-model="listIntro"
                name="intro"
                rows="3"
                maxlength="500"
                :aria-describedby="field.describedBy"
                :aria-invalid="field.invalid"
              />
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

    <section class="band section" data-paint="2" aria-labelledby="password-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="password-title" class="section-title">{{ t('settings.passwordTitle') }}</h2>
          <p class="intro">{{ t('settings.passwordIntro') }}</p>
        </div>
        <div class="section-body">
          <form :ref="password.form" class="form" method="post" novalidate aria-labelledby="password-title" @submit.prevent="password.run">
            <p v-if="password.message.value" class="form-message" role="alert">{{ password.message.value }}</p>
            <!-- Lets a password manager tie the new password to the right account. -->
            <input type="email" name="email" autocomplete="username" :value="me?.email" hidden readonly>
            <PasswordField id="current-password" v-model="currentPassword" :label="t('settings.currentPassword')" autocomplete="current-password" :error="password.errors.value.currentPassword" />
            <PasswordField id="new-password" v-model="newPassword" :label="t('settings.newPassword')" :hint="t('auth.passwordHint')" autocomplete="new-password" :minlength="10" :error="password.errors.value.newPassword" />
            <div class="actions">
              <art-button>
                <button type="submit" :disabled="password.pending.value">{{ t('settings.changePassword') }}</button>
              </art-button>
            </div>
            <p class="form-message" role="status">{{ passwordSaved }}</p>
          </form>
        </div>
      </div>
    </section>
  </div>
</template>
