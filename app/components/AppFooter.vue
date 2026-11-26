<script setup lang="ts">
import { NEW_ISSUE_URL } from '#shared/utils/source'

// The signature only ever gets fixed text: art-signature writes its text into innerHTML.
const year = new Date().getFullYear()

const { t } = useI18n()
const localePath = useLocalePath()
</script>

<template>
  <footer class="band page-footer" data-paint="deep">
    <div class="inner">
      <!-- Gesso's footer note: where a fault is reported, the same words on every site. -->
      <i18n-t keypath="footer.issue" tag="p" class="footer-note" scope="global">
        <template #link>
          <a :href="NEW_ISSUE_URL">{{ t('footer.issueLink') }}</a>
        </template>
      </i18n-t>
      <LocaleSwitcher />
      <nav :aria-label="t('footer.label')">
        <NuxtLink :to="localePath('/about')">{{ t('footer.about') }}</NuxtLink>
        <NuxtLink :to="localePath('/privacy')">{{ t('footer.privacy') }}</NuxtLink>
        <NuxtLink :to="localePath('/terms')">{{ t('footer.terms') }}</NuxtLink>
      </nav>
      <SchemeButton />
      <art-signature :year="year">Art Van der Vennet</art-signature>
    </div>
  </footer>
</template>
