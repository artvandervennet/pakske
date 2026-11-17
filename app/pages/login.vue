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
          <PasswordField id="password" v-model="password" :label="t('auth.password')" autocomplete="current-password" :error="errors.password" />
          <div class="actions">
            <art-button>
              <button type="submit" :disabled="pending">{{ pending ? t('auth.busy') : t('auth.login') }}</button>
            </art-button>
          </div>
          <p>
            {{ t('auth.noAccount') }}
            <NuxtLink :to="{ path: localePath('/register'), query: next ? { next } : {} }">{{ t('auth.register') }}</NuxtLink>
          </p>
        </form>
      </div>
    </section>
  </div>
</template>
