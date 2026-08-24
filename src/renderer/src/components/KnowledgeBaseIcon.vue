<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'

import type { KnowledgeBaseIconDto } from '../../../shared/contracts'

const props = withDefaults(
  defineProps<{
    icon: KnowledgeBaseIconDto | null
    fallback?: string
  }>(),
  { fallback: 'T' }
)

const safeSvg = computed(() =>
  props.icon?.svg
    ? DOMPurify.sanitize(props.icon.svg, {
        USE_PROFILES: { svg: true, svgFilters: false },
        FORBID_TAGS: ['script', 'foreignObject'],
        FORBID_ATTR: ['onload', 'onclick', 'onerror', 'style']
      })
    : ''
)
</script>

<template>
  <span class="knowledge-base-icon" aria-hidden="true">
    <img v-if="icon?.src" :src="icon.src" alt="" />
    <!-- The knowledge-base SVG has already passed through the strict DOMPurify profile above. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <span v-else-if="safeSvg" class="inline-svg" v-html="safeSvg" />
    <span v-else class="icon-fallback">{{ fallback.slice(0, 1).toUpperCase() }}</span>
  </span>
</template>

<style scoped>
.knowledge-base-icon {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: inherit;
}

.knowledge-base-icon img,
.inline-svg,
.inline-svg :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

.icon-fallback {
  display: grid;
  place-items: center;
  color: var(--accent);
  font-size: inherit;
  font-weight: 750;
}
</style>
