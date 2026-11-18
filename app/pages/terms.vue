<script setup lang="ts">
// What the site and the people who use it may expect of each other. Open to everyone.
const { operator } = useRuntimeConfig().public
</script>

<template>
  <LegalPage name="terms" :sections="termsOutline(operator)" :params="{ operator: operator.name, network: operator.network }" />
</template>
