<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { user } = useUserSession()

useHead({ title: () => t('auth.loginTitle') })

// Where to go after logging in: only a path on this site, never another site.
const origin = useRequestURL().origin
const next = computed(() => safeNextPath(route.query.next, origin))

if (user.value) await navigateTo(next.value ?? localePath('/'))

// Back from Google with a reason it didn't work (server/routes/auth/google.get.ts).
const { te } = useI18n()
const googleMessage = computed(() => {
  const code = route.query.google
  return typeof code === 'string' && te(`errors.${code}`) ? t(`errors.${code}`) : ''
})

const email = useFieldValue('email')
const password = useFieldValue('password')

const { form, pending, message, errors, run } = useForm(async () => {
  await $fetch('/api/auth/login', {
    method: 'POST',
    body: { email: email.value, password: password.value },
  })
  // A full page load: everything on screen is then rendered for the person who just logged in.
  window.location.assign(next.value ?? localePath('/'))
})
</script>

<template>
  <div>
    <PageHead :title="t('auth.loginTitle')" :lead="t('auth.loginLead')" />
    <section class="band wide" data-paint="1">
      <div class="inner">
        <form ref="form" class="form" method="post" novalidate @submit.prevent="run">
          <p v-if="googleMessage" class="form-message" role="alert">{{ googleMessage }}</p>
          <p v-if="message" class="form-message" role="alert">{{ message }}</p>
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
          <!-- "Wachtwoord vergeten?" shows on the password's label line, but comes after Inloggen when
               tabbing: from the email, Tab goes straight to the password (app.css). -->
          <div class="password-then-login">
            <PasswordField id="password" v-model="password" :label="t('auth.password')" autocomplete="current-password" :error="errors.password" />
            <div class="actions wide">
              <art-button>
                <button type="submit" :aria-disabled="pending || undefined">{{ pending ? t('auth.busy') : t('auth.login') }}</button>
              </art-button>
            </div>
            <NuxtLink class="forgot-link" :to="{ path: localePath('/forgot'), query: email ? { email } : {} }">{{ t('auth.forgotLink') }}</NuxtLink>
          </div>
          <GoogleLogin :from="route.path" :next="next" :label="t('auth.google')" :or="t('auth.or')" />
          <p>
            {{ t('auth.noAccount') }}
            <NuxtLink :to="{ path: localePath('/register'), query: next ? { next } : {} }">{{ t('auth.register') }}</NuxtLink>
          </p>
        </form>
      </div>
    </section>
  </div>
</template>
