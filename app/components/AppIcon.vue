<script setup lang="ts">
// A small line drawing beside or instead of a button's words. It is drawn in the colour of the
// text around it and as large as that text (see .icon in app.css), and it is hidden from screen
// readers: the control it sits in always has words of its own, visible or as an aria-label.
// The drawings are kept here, inline, so the server sends them with the page and nothing is
// fetched for them.
const PATHS = {
  'share': 'M12 15V4m0 0L8 8m4-4 4 4M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  'close': 'M6 6l12 12M18 6 6 18',
  'link': 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  'plus': 'M12 5v14M5 12h14',
  'minus': 'M5 12h14',
  'image': 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 16l4.5-4.5 4 4L15 13l5 5M8.6 9h.01',
  'pencil': 'M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z',
  'add-to-list': 'M4 6h11M4 12h8M4 18h6M17 13v7M13.5 16.5h7',
  'chevron': 'M6 9l6 6 6-6',
  'check': 'M5 12.5l4.5 4.5L19 7.5',
  // Six dots, each a line without length that its round ends make a dot.
  'grip': 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
} as const

export type IconName = keyof typeof PATHS

defineProps<{ name: IconName }>()
</script>

<template>
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path :d="PATHS[name]" />
  </svg>
</template>
