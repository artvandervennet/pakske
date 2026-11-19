<script setup lang="ts">
useSiteHead()
useRouteFocus()
</script>

<template>
  <!-- Says the new page's title to a screen reader after a navigation inside the site. -->
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
