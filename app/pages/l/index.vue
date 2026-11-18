<script setup lang="ts">
// A list's address with its last part taken off. There is no list here, but whoever does that
// is looking for what is one step up: the page with all their lists.
const localePath = useLocalePath()
await navigateTo(localePath('/lists'), { replace: true })
</script>

<template>
  <div />
</template>
