<script setup lang="ts">
// "Wachtwoord vergeten": Firebase mails a link to choose a new one. The page says the same
// whether the address has an account or not.
const { t, locale } = useI18n()
const localePath = useLocalePath()
const route = useRoute()

useHead({ title: () => t('auth.forgotTitle') })

const email = useFieldValue('email', typeof route.query.email === 'string' ? route.query.email : '')
const sent = ref('')

const { form, pending, message, errors, run } = useForm(async () => {
  sent.value = ''
  await $fetch('/api/auth/forgot', { method: 'POST', body: { email: email.value, locale: locale.value } })
  sent.value = t('auth.forgotSent', { email: email.value.trim() })
})
</script>

<template>
  <div>
    <PageHead :title="t('auth.forgotTitle')" :lead="t('auth.forgotLead')" />
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
              enterkeyhint="send"
              :aria-describedby="field.describedBy"
              :aria-invalid="field.invalid"
            >
          </FormField>
          <div class="actions">
            <art-button>
              <button type="submit" :aria-disabled="pending || undefined">{{ pending ? t('auth.busy') : t('auth.forgotSend') }}</button>
            </art-button>
          </div>
          <p class="form-message" role="status">{{ sent }}</p>
          <p><NuxtLink :to="localePath('/login')">{{ t('auth.backToLogin') }}</NuxtLink></p>
        </form>
      </div>
    </section>
  </div>
</template>
