<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    shortcut?: string
    placement?: 'top' | 'bottom'
    /** Horizontal alignment relative to the host. Use `end` near a right edge. */
    align?: 'center' | 'start' | 'end'
  }>(),
  { shortcut: '', placement: 'bottom', align: 'center' }
)
</script>

<template>
  <span class="ui-tooltip-host">
    <slot />
    <span
      class="ui-tooltip-popover"
      :class="[`placement-${placement}`, `align-${align}`]"
      role="tooltip"
    >
      <strong>{{ label }}</strong>
      <kbd v-if="shortcut">{{ shortcut }}</kbd>
    </span>
  </span>
</template>

<style scoped>
.ui-tooltip-host {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ui-tooltip-popover {
  position: absolute;
  z-index: 1000;
  min-width: max-content;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  background: #171719;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.34);
  padding: 7px 9px;
  color: #f5f5f6;
  text-align: left;
  transition:
    opacity 100ms ease 260ms,
    transform 100ms ease 260ms,
    visibility 0s linear 360ms;
}

.align-center {
  left: 50%;
  transform: translateX(-50%) translateY(-3px);
}

.align-start {
  left: 0;
  transform: translateY(-3px);
}

.align-end {
  right: 0;
  left: auto;
  transform: translateY(-3px);
}

.placement-bottom {
  top: calc(100% + 8px);
}

.placement-top {
  bottom: calc(100% + 8px);
}

.placement-top.align-center {
  transform: translateX(-50%) translateY(3px);
}

.placement-top.align-start,
.placement-top.align-end {
  transform: translateY(3px);
}

.ui-tooltip-host:hover .ui-tooltip-popover,
.ui-tooltip-host:has(:focus-visible) .ui-tooltip-popover {
  visibility: visible;
  opacity: 1;
  transition-delay: 260ms;
}

.ui-tooltip-host:hover .align-center,
.ui-tooltip-host:has(:focus-visible) .align-center {
  transform: translateX(-50%) translateY(0);
}

.ui-tooltip-host:hover .align-start,
.ui-tooltip-host:has(:focus-visible) .align-start,
.ui-tooltip-host:hover .align-end,
.ui-tooltip-host:has(:focus-visible) .align-end {
  transform: translateY(0);
}

.ui-tooltip-popover strong {
  font-size: 11px;
  font-weight: 620;
  line-height: 1.25;
}

.ui-tooltip-popover kbd {
  color: #a9a9ae;
  font-family: var(--font-sans);
  font-size: 9px;
  line-height: 1.2;
}
</style>
