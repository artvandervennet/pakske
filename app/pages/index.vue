<script setup lang="ts">
import type { DirectoryEntry } from '#shared/schemas/list'

const { t } = useI18n()
const localePath = useLocalePath()
const { user } = useUserSession()

useHead({ title: () => t('home.title') })

const { data: lists } = await useFetch<DirectoryEntry[]>('/api/lists')
</script>

<template>
  <div>
    <div class="band hero" data-paint="deep">
      <div class="inner">
        <h1>{{ t('home.title') }}</h1>
        <p class="lead">{{ t('home.lead') }}</p>
        <div class="actions">
          <art-button v-if="user" size="l">
            <NuxtLink :to="localePath(`/u/${user.username}`)">{{ t('home.openMine') }}</NuxtLink>
          </art-button>
          <template v-else>
            <art-button size="l">
              <NuxtLink :to="localePath('/register')">{{ t('home.makeYours') }}</NuxtLink>
            </art-button>
            <art-button size="l" variant="secondary">
              <NuxtLink :to="localePath('/login')">{{ t('nav.login') }}</NuxtLink>
            </art-button>
          </template>
        </div>
      </div>
      <art-drip class="band-drip" pigment="--surface" stagger flush />
    </div>

    <section class="band section" data-paint="1" aria-labelledby="lists-title">
      <div class="inner">
        <div class="section-head">
          <h2 id="lists-title" class="section-title">{{ t('home.listsTitle') }}</h2>
          <p class="intro">{{ t('home.listsIntro') }}</p>
        </div>
        <div class="section-body">
          <ul v-if="lists?.length" class="card-grid">
            <li v-for="list in lists" :key="list.username">
              <art-canvas bare>
                <div class="person-card">
                  <span class="avatar" aria-hidden="true">{{ list.displayName.charAt(0).toUpperCase() }}</span>
                  <div>
                    <h3>
                      <NuxtLink :to="localePath(`/u/${list.username}`)">{{ list.displayName }}</NuxtLink>
                    </h3>
                    <p class="muted">{{ t('home.wishes', list.wishes) }}</p>
                  </div>
                </div>
              </art-canvas>
            </li>
          </ul>
          <div v-else class="empty">
            <art-splatter pigment="complement" seed="no-lists" />
            <p>{{ t('home.empty') }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
