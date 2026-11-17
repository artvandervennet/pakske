<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { user } = useUserSession()

useHead({ title: () => t('auth.registerTitle') })

if (user.value) await navigateTo(localePath(`/u/${user.value.username}`))

const displayName = useFieldValue('name')
const email = useFieldValue('email')
const username = useFieldValue('list-address')
const password = useFieldValue('new-password')

// Suggest an address from the name until the person types their own.
const usernameTouched = ref(username.value !== '')
watch(displayName, (name) => {
  if (usernameTouched.value) return
  username.value = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}, { immediate: true })

// The hint shows the address being typed. The server renders it without one, so the first
// client render must too; after that it follows the field.
const mounted = ref(false)
onMounted(() => (mounted.value = true))
const addressPreview = computed(() => `/u/${(mounted.value && username.value) || '…'}`)

const { form, pending, message, errors, run } = useForm(async () => {
  const account = await $fetch<{ username: string }>('/api/auth/register', {
    method: 'POST',
    body: { displayName: displayName.value, email: email.value, username: username.value, password: password.value },
  })
  window.location.assign(localePath(`/u/${account.username}`))
})
</script>

<template>
  <div>
    <PageHead :title="t('auth.registerTitle')" :lead="t('auth.registerLead')" />
    <section class="band wide" data-paint="1">
      <div class="inner">
        <form ref="form" class="form" method="post" novalidate @submit.prevent="run">
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
          <FormField id="list-address" v-slot="field" :label="t('auth.username')" :hint="t('auth.usernameHint', { address: addressPreview })" :error="errors.username">
            <input
              id="list-address"
              v-model="username"
              name="list-address"
              type="text"
              autocomplete="off"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              maxlength="30"
              required
              enterkeyhint="done"
              :aria-describedby="field.describedBy"
              :aria-invalid="field.invalid"
              @input="usernameTouched = true"
            >
          </FormField>
          <div class="actions">
            <art-button>
              <button type="submit" :disabled="pending">{{ pending ? t('auth.busy') : t('auth.register') }}</button>
            </art-button>
          </div>
          <p>
            {{ t('auth.haveAccount') }}
            <NuxtLink :to="localePath('/login')">{{ t('auth.login') }}</NuxtLink>
          </p>
        </form>
      </div>
    </section>
  </div>
</template>
