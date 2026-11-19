<script setup lang="ts">
// A button that hands on the address of a page on this site. It is Gesso's <art-share> with
// this site's words and icons. With `share` it reads "Delen" and opens the device's own share
// sheet with those words and the address, to send on with WhatsApp or anything else there. A
// browser without a share sheet, and a button without `share`, copies the address and says so
// in the button itself for a few seconds: nothing appears beside it, so what stands next to it
// stays where it is. Without a clipboard (the site served over plain http on a home network,
// or permission refused) the element shows the address to copy by hand.
// Whoever just made the link can open the sheet at once (`share()`), without a second press.
defineProps<{ path: string, share?: { title: string, text: string } }>()
const { t } = useI18n()

const element = useTemplateRef<HTMLElement & { share?: () => Promise<boolean> }>('element')

/**
 * Opens the share sheet. False when there is none here or the browser wouldn't open it, which
 * it only does for a press: the button is still there to press then.
 */
const openSheet = () => element.value?.share?.() ?? Promise.resolve(false)

defineExpose({ share: openSheet })
</script>

<template>
  <art-share
    ref="element"
    :url="path"
    :text="share?.text"
    :heading="share?.title"
    :nosheet="share ? undefined : ''"
    :copied-label="t('share.copied')"
    :manual-label="t('share.manual')"
  >
    <art-button variant="secondary">
      <!-- The wordings lie on top of each other and <art-share> shows the one for the moment,
           so the button is always as wide as the longest. The first shows until it has loaded. -->
      <button type="button">
        <span class="wordings">
          <span v-if="share" data-when="share"><AppIcon name="share" />{{ t('share.open') }}</span>
          <span data-when="copy"><AppIcon name="share" />{{ t('share.copy') }}</span>
          <span data-when="copied"><AppIcon name="check" />{{ t('share.copiedShort') }}</span>
        </span>
      </button>
    </art-button>
  </art-share>
</template>
