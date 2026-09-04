// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { resolveTabDropPlacement, useTabDragLifecycle, useTabDragStore } from './tabDrag'

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => document.body.replaceChildren())

describe('tab drop geometry', () => {
  const bounds = { left: 100, top: 200, width: 400, height: 600 }
  it.each([
    [110, 500, 'left'],
    [490, 500, 'right'],
    [300, 210, 'top'],
    [300, 790, 'bottom'],
    [300, 500, 'center'],
    [90, 500, null],
    [300, 190, null]
  ] as const)('resolves (%s, %s) to %s', (x, y, expected) => {
    expect(resolveTabDropPlacement(bounds, x, y)).toBe(expected)
  })
  it('chooses only the nearest edge at corners and ignores collapsed regions', () => {
    expect(resolveTabDropPlacement(bounds, 140, 210)).toBe('top')
    expect(resolveTabDropPlacement(bounds, 101, 240)).toBe('left')
    expect(resolveTabDropPlacement({ ...bounds, height: 0 }, 300, 200)).toBeNull()
  })
})

describe('workspace drag lifecycle', () => {
  const Host = defineComponent({
    setup() {
      useTabDragLifecycle()
      return () => h('div', { class: 'outside-group' })
    }
  })
  it.each(['dragend', 'blur', 'pointerup', 'escape', 'pointermove', 'drop'])(
    'clears source and target after %s, including events stopped by a descendant',
    async (kind) => {
      const wrapper = mount(Host, { attachTo: document.body })
      const drag = useTabDragStore()
      drag.start('source')
      drag.target = { groupId: 'target', placement: 'bottom' }
      const event =
        kind === 'escape'
          ? new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
          : kind === 'pointermove'
            ? new PointerEvent('pointermove', { buttons: 0, bubbles: true })
            : new Event(kind, { bubbles: true })
      if (kind === 'blur') window.dispatchEvent(event)
      else {
        wrapper.element.addEventListener(event.type, (event) => event.stopPropagation())
        wrapper.element.dispatchEvent(event)
      }
      await nextTick()
      if (kind === 'drop') await new Promise((resolve) => setTimeout(resolve, 0))
      expect(drag.tabId).toBeNull()
      expect(drag.target).toBeNull()
      wrapper.unmount()
    }
  )
  it('clears only the preview on invalid-area hover and cleans the session when unmounted', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const drag = useTabDragStore()
    drag.start('source')
    drag.target = { groupId: 'target', placement: 'bottom' }
    await wrapper.trigger('dragover')
    expect(drag.tabId).toBe('source')
    expect(drag.target).toBeNull()
    wrapper.unmount()
    expect(drag.tabId).toBeNull()
    drag.start('after-unmount')
    window.dispatchEvent(new Event('dragend'))
    expect(drag.tabId).toBe('after-unmount')
  })
})
