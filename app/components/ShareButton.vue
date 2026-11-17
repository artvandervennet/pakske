<script setup lang="ts">
// Copies the full address of a page on this site. Without a clipboard (the site served over
// plain http on a home network, or permission refused) it shows the address to copy by hand.
const props = defineProps<{ path: string }>()
const { t } = useI18n()

const id = useId()
const status = ref('')
const address = ref('')
const field = ref<HTMLInputElement>()
let timer: ReturnType<typeof setTimeout> | undefined
let lastStatus = ''

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
  // Emptied afterwards, so no stale "copied" stays behind for someone reading the page later.
  timer = setTimeout(() => (status.value = ''), 4000)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="share">
    <art-button variant="secondary">
      <button type="button" @click="copy">{{ t('share.copy') }}</button>
    </art-button>
    <span class="share-status" role="status">{{ status }}</span>
    <div v-if="address" class="field">
      <label :for="id">{{ t('share.manual') }}</label>
      <input :id="id" ref="field" type="text" readonly :value="address" @focus="field?.select()">
    </div>
  </div>
</template>
