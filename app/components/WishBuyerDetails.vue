<script setup lang="ts">
import type { WishView } from '#shared/schemas/list'
import type { WishTickState } from '~/composables/useWishTick'

// The body of an opened card for someone who doesn't own the wish: the photo, the text and the
// shop links, and for someone who is logged in one block to give it: the button or the stepper
// (WishGive), the choice to give without your name, who gives, and the notes. A visitor who
// isn't logged in gets a way to log in that brings them back to this row. An owner gets
// WishEditor instead. Putting the wish on a list of your own is the button in the card's head.
// `owners` is the list's owners. The notes are hidden from them and from the wish's other owners.
// `tick` is the row's own tick (useWishTick), shown here with its full stepper.
// `bare` is the page behind a list's old link: the wish and the viewer's own tick, nothing about
// anyone else and nothing to write.
const props = defineProps<{ wish: WishView, token: string, owners: string[], tick: WishTickState, bare?: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const names = useNames()
const route = useRoute()
const localePath = useLocalePath()

const linkHosts = computed(() => linkNames(props.wish.urls))

// Giving without your name. The switch is the one place where that is chosen for this wish.
// With a purchase, changing it saves at once; without one, the tick that follows takes it along
// (useBuyAnonymously). Until it is used, the account's own setting counts.
const { isAnonymous, choiceFor, choose } = useBuyAnonymously()
const { parse } = useApiError()
const anonymousId = useId()
const anonymousBusy = ref(false)
const anonymousError = ref('')

async function onAnonymous(event: Event) {
  const input = event.target as HTMLInputElement
  const anonymous = input.checked
  if (props.wish.role !== 'buyer' || anonymousBusy.value) return
  const before = choiceFor(props.wish.id)
  choose(props.wish.id, anonymous)
  anonymousError.value = ''
  if (props.wish.mine === 0) return
  anonymousBusy.value = true
  try {
    await $fetch(`/api/lists/${props.token}/wishes/${props.wish.id}/purchase`, { method: 'PUT', body: { quantity: props.wish.mine, anonymous } })
    emit('changed')
  }
  catch (error) {
    // Not saved: the choice is as it was before, and the switch shows that again.
    choose(props.wish.id, before)
    input.checked = isAnonymous(props.wish)
    anonymousError.value = parse(error).message
  }
  finally {
    anonymousBusy.value = false
  }
}
// Everyone who never sees the notes: the list's owners and the wish's other owners.
const hiddenFrom = computed(() => [...props.owners, ...props.wish.sharedWith])
const id = useId()
const loginLink = computed(() => ({
  path: localePath('/login'),
  query: { next: `${route.path}#wish-${props.wish.id}` },
}))

// The picture large, in the page's viewer.
const viewPicture = usePictureViewer()
function enlarge(event: MouseEvent) {
  if (!props.wish.image) return
  viewPicture?.({ src: props.wish.image, title: props.wish.title }, (event.currentTarget as HTMLElement).querySelector('img'))
}
</script>

<template>
  <!-- On a wide card a buyer's side has two columns: the wish and giving it, and beside them
       what the buyers tell each other. A visitor has only the first, as text. -->
  <div class="wish-card-body buyer" :class="{ pictured: wish.image, noted: wish.role === 'buyer' && !bare }">
    <!-- The picture is the button that shows it large; the mark on its corner says so where
         there is no pointer to turn into a magnifying glass. -->
    <button v-if="wish.image && viewPicture" type="button" class="wish-picture-zoom" :aria-label="t('wish.pictureEnlarge')" @click="enlarge">
      <img class="wish-picture" :src="wish.image" alt="" decoding="async">
      <AppIcon name="expand" />
    </button>
    <img v-else-if="wish.image" class="wish-picture" :src="wish.image" alt="" decoding="async">
    <div class="wish-card-column">
      <p v-if="wish.role === 'buyer' && wish.removed && !bare" class="form-message">
        {{ owners.length ? t('wish.removedIntro', { names: names(owners), days: KEPT_FOR_BUYERS_DAYS }, owners.length) : t('wish.removedIntroNobody', { days: KEPT_FOR_BUYERS_DAYS }) }}
      </p>
      <p v-if="wish.description" class="wish-text">{{ wish.description }}</p>
      <ul v-if="wish.urls.length" class="wish-links">
        <li v-for="(url, index) in wish.urls" :key="url">
          <art-button variant="secondary" size="s">
            <a :href="url" target="_blank" rel="noopener noreferrer"><AppIcon name="link" />{{ t('wish.viewOn', { host: linkHosts[index] }) }}<span class="visually-hidden"> {{ t('wish.newTab') }}</span></a>
          </art-button>
        </li>
      </ul>

      <template v-if="wish.role === 'buyer'">
        <div class="wish-give-block">
          <!-- Also on a wish that left the list, where it can only be lowered: it stays, unavailable,
               after the last one was taken back, so the focus has somewhere to be. -->
          <WishGive :wish="wish" :tick="tick" />
          <div v-if="!wish.removed" class="switch-field">
            <label class="switch">
              <input
                type="checkbox"
                role="switch"
                :checked="isAnonymous(wish)"
                :aria-busy="anonymousBusy || undefined"
                :aria-describedby="`${anonymousId}-hint`"
                @change="onAnonymous"
              >
              {{ t('purchase.anonymous') }}
            </label>
            <p :id="`${anonymousId}-hint`" class="switch-hint">{{ t('purchase.anonymousHint') }}</p>
            <p v-if="anonymousError" class="inline-field-error" role="alert">{{ anonymousError }}</p>
          </div>
        </div>

        <div v-if="!bare" class="wish-field">
          <h4 :id="`${id}-who`" class="wish-label">{{ t('purchase.title') }}</h4>
          <ul v-if="wish.purchases.length" class="people" :aria-labelledby="`${id}-who`">
            <li v-for="(purchase, index) in wish.purchases" :key="index" :class="{ mine: purchase.mine }">
              <span>{{ purchase.mine ? (purchase.anonymous ? t('purchase.youAnonymous') : t('purchase.you')) : purchase.name ?? t('purchase.someone') }}</span>
              <span v-if="wish.quantity !== 1" class="count">{{ purchase.quantity }}×</span>
            </li>
          </ul>
          <p v-else class="muted">{{ t('purchase.nobody') }}</p>
        </div>
      </template>

      <p v-else-if="wish.role === 'anon'" class="muted">
        {{ t('wish.anonHint') }}
        <NuxtLink :to="loginLink">{{ t('nav.login') }}</NuxtLink>
      </p>
    </div>
    <div v-if="wish.role === 'buyer' && !bare" class="wish-card-column">
      <WishNotes :wish="wish" :token="token" :hidden-from="hiddenFrom" @changed="emit('changed')" />
    </div>
  </div>
</template>
