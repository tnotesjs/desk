<script setup lang="ts">
import type { NotePageWidth } from '../../../shared/contracts'

defineProps<{ mode: NotePageWidth }>()
</script>

<template>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path v-if="mode === 'wide'" d="M10 12H3m0 0 3-3m-3 3 3 3m8-3h7m0 0-3-3m3 3-3 3" />
    <path v-else d="M3 12h7m0 0-3-3m3 3-3 3m14-3h-7m0 0 3-3m-3 3 3 3" />
  </svg>
</template>
