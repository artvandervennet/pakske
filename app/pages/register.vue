<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { user } = useUserSession()

useHead({ title: () => t('auth.registerTitle') })

// Where to go once the account exists: only a path on this site, never another site.
const origin = useRequestURL().origin
const next = computed(() => safeNextPath(route.query.next, origin))

if (user.value) await navigateTo(next.value ?? localePath('/'))

// Back from Google with a reason it didn't work (server/routes/auth/google.get.ts).
const { te } = useI18n()
const googleMessage = computed(() => {
  const code = route.query.google
  return typeof code === 'string' && te(`errors.${code}`) ? t(`errors.${code}`) : ''
})

const displayName = useFieldValue('name')
const email = useFieldValue('email')
const password = useFieldValue('new-password')

const { form, pending, message, errors, run } = useForm(async () => {
  await $fetch('/api/auth/register', {
    method: 'POST',
    body: { displayName: displayName.value, email: email.value, password: password.value },
  })
  // A full page load: everything on screen is then rendered for the person who just registered.
  window.location.assign(next.value ?? localePath('/'))
})
</script>

<template>
  <div>
    <PageHead :title="t('auth.registerTitle')" :lead="t('auth.registerLead')" />
    <section class="band wide" data-paint="1">
      <div class="inner">
        <form ref="form" class="form" method="post" novalidate @submit.prevent="run">
          <p v-if="googleMessage" class="form-message" role="alert">{{ googleMessage }}</p>
          <GoogleLogin :from="route.path" :next="next" :label="t('auth.google')" :or="t('auth.or')" />
          <p v-if="message" class="form-message" role="alert">{{ message }}</p>
          <FormField id="name" v-slot="field" :label="t('auth.displayName')" :hint="t('auth.displayNameHint')" :error="errors.displayName">
            <input
              id="name"
              v-model="displayName"
              name="name"
              type="text"
              autocomplete="name"
              maxlength="60"
              required
              enterkeyhint="next"
              :aria-describedby="field.describedBy"
              :aria-invalid="field.invalid"
            >
          </FormField>
          <FormField id="email" v-slot="field" :label="t('auth.email')" :error="errors.email">
            <input
              id="email"
              v-model="email"
              name="email"
              type="email"
              autocomplete="username"
              spellcheck="false"
              required
              enterkeyhint="next"
              :aria-describedby="field.describedBy"
              :aria-invalid="field.invalid"
            >
          </FormField>
          <PasswordField id="new-password" v-model="password" :label="t('auth.password')" :hint="t('auth.passwordHint')" autocomplete="new-password" :minlength="10" :error="errors.password" />
          <div class="actions">
            <art-button>
              <button type="submit" :disabled="pending">{{ pending ? t('auth.busy') : t('auth.register') }}</button>
            </art-button>
          </div>
          <p>
            {{ t('auth.haveAccount') }}
            <NuxtLink :to="{ path: localePath('/login'), query: next ? { next } : {} }">{{ t('auth.login') }}</NuxtLink>
          </p>
        </form>
      </div>
    </section>
  </div>
</template>
