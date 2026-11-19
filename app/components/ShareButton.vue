<script setup lang="ts">
import { shareMessage } from '#shared/utils/share'

// Copies the full address of a page on this site, and says so in the button itself for a few
// seconds: nothing appears beside it, so what stands next to it stays where it is. A screen
// reader doesn't read a button's new words while the focus is on it, so the same is said in a
// status line nobody sees. Without a clipboard (the site served over plain http on a home
// network, or permission refused) it shows the address to copy by hand.
// With `share` it is "Delen" instead, and opens the device's own share sheet with those words
// and the address, to send on with WhatsApp or anything else there. A browser without a share
// sheet gets the copy button, as if `share` wasn't given.
const props = defineProps<{ path: string, share?: { title: string, text: string } }>()
const { t } = useI18n()

const id = useId()
const status = ref('')
const copied = ref(false)
const address = ref('')
const field = ref<HTMLInputElement>()
let timer: ReturnType<typeof setTimeout> | undefined
let lastStatus = ''

// The server can't know what the browser can do, so it sends "Delen" wherever sharing is
// meant. A browser without a share sheet changes that to the copy button once it has the page.
const sharing = ref(props.share !== undefined)
onMounted(() => {
  sharing.value = props.share !== undefined && typeof navigator.share === 'function'
})

async function press() {
  if (!sharing.value || !props.share) return copy()
  try {
    // The link goes in the words and not beside them as `url`: given both, the apps in the
    // sheet of a Mac or an iPhone send the address alone.
    await navigator.share({ title: props.share.title, text: shareMessage(props.share.text, location.origin + props.path) })
  }
  catch (failure) {
    // Closing the sheet without choosing is no failure. Anything else: the link at least.
    if (failure instanceof DOMException && failure.name === 'AbortError') return
    await copy()
  }
}

async function copy() {
  const url = location.origin + props.path
  try {
    await navigator.clipboard.writeText(url)
  }
  catch {
    address.value = url
    await nextTick()
    field.value?.select()
    return
  }
  address.value = ''
  say(t('share.copied'))
}

function say(message: string) {
  clearTimeout(timer)
  // VoiceOver skips a message equal to the one before it. A no-break space makes it differ
  // without being read out.
  status.value = message === lastStatus ? `${message} ` : message
  lastStatus = status.value
  copied.value = true
  // Back to what the button does, and emptied, so no stale "copied" stays behind for someone
  // reading the page later.
  timer = setTimeout(() => {
    copied.value = false
    status.value = ''
  }, 3000)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="share">
    <art-button variant="secondary">
      <!-- The wordings lie on top of each other and one shows, so the button is always as wide
           as the longest. The hidden ones are no part of the button's name. -->
      <button type="button" @click="press">
        <span class="share-faces">
          <span v-if="share" class="share-face" :class="{ away: copied || !sharing }"><AppIcon name="share" />{{ t('share.open') }}</span>
          <span class="share-face" :class="{ away: copied || sharing }"><AppIcon name="share" />{{ t('share.copy') }}</span>
          <span class="share-face" :class="{ away: !copied }"><AppIcon name="check" />{{ t('share.copiedShort') }}</span>
        </span>
      </button>
    </art-button>
    <span class="visually-hidden" role="status">{{ status }}</span>
    <div v-if="address" class="field">
      <label :for="id">{{ t('share.manual') }}</label>
      <input :id="id" ref="field" type="text" readonly :value="address" @focus="field?.select()">
    </div>
  </div>
</template>
