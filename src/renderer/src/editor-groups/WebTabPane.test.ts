// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { useEditorStore } from '../stores/editor'
import { useTabDragStore } from './tabDrag'
import WebTabPane from './WebTabPane.vue'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'desk')
})

it('temporarily hides native web views during tab drags and restores them without overriding modal suspension', async () => {
  setActivePinia(createPinia())
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600)
  )
  const layout = vi.fn(async () => ({ ok: true, value: undefined }))
  Object.defineProperty(window, 'desk', {
    configurable: true,
    value: {
      web: {
        layout,
        create: vi.fn(async () => ({
          ok: true,
          value: {
            tabId: 'web-test',
            url: 'https://example.com',
            title: 'Test',
            loading: false,
            canGoBack: false,
            canGoForward: false
          }
        }))
      }
    }
  })
  const wrapper = mount(WebTabPane, {
    props: {
      tab: { id: 'web-test', type: 'web', url: 'https://example.com', title: 'Test' },
      active: true
    }
  })
  await flushPromises()
  expect(layout).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  const drag = useTabDragStore()
  drag.start('some-tab')
  await flushPromises()
  expect(layout).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  drag.finish()
  await flushPromises()
  expect(layout).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true }))
  useEditorStore().webViewsSuspended = true
  drag.start('some-tab')
  await flushPromises()
  drag.finish()
  await flushPromises()
  expect(layout).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }))
  wrapper.unmount()
})
