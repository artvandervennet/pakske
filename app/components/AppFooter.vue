<script setup lang="ts">
// The signature only ever gets fixed text: art-signature writes its text into innerHTML.
const year = new Date().getFullYear()
</script>

<template>
  <footer class="band page-footer" data-paint="deep">
    <div class="inner">
      <LocaleSwitcher />
      <art-signature :year="year">Art Van der Vennet</art-signature>
    </div>
  </footer>
</template>
