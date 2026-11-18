<script setup lang="ts">
// What the site keeps about a person. Open to everyone, logged in or not.
const { operator } = useRuntimeConfig().public
</script>

<template>
  <LegalPage name="privacy" :sections="privacyOutline(operator)" :params="{ operator: operator.name, network: operator.network }" />
</template>
