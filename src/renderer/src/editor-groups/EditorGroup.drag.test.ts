// @vitest-environment happy-dom
import { shallowMount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useEditorStore } from '../stores/editor'
import { TAB_DRAG_MIME, useTabDragStore } from './tabDrag'
import EditorGroup from './EditorGroup.vue'

const wrappers: VueWrapper[] = []
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

function fixture(): { wrapper: VueWrapper; ids: string[]; groupId: string } {
  const editor = useEditorStore()
  const ids = ['a', 'b', 'c'].map((name) => editor.openWeb(`https://example.com/${name}`))
  const group = editor.activeGroup!
  const wrapper = shallowMount(EditorGroup, { props: { group } })
  wrappers.push(wrapper)
  vi.spyOn(wrapper.get('.editor-group-body').element, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 200, 400, 600)
  )
  return { wrapper, ids, groupId: group.id }
}

async function start(wrapper: VueWrapper, index = 0): Promise<DataTransfer> {
  const dataTransfer = new DataTransfer()
  await wrapper.findAll('.tab')[index].trigger('dragstart', { dataTransfer })
  return dataTransfer
}

describe('tab drag preview and drop handling', () => {
  it('renders one neutral area only at a valid edge, excluding the actual tabs region', async () => {
    const { wrapper } = fixture()
    const dataTransfer = await start(wrapper)
    expect(wrapper.find('.tab-drop-preview').exists()).toBe(false)
    expect(wrapper.find('.tab-drag-surface').exists()).toBe(true)
    for (const [clientX, clientY, direction] of [
      [110, 500, 'left'],
      [490, 500, 'right'],
      [300, 210, 'top'],
      [300, 790, 'bottom']
    ] as const) {
      await wrapper.get('.tab-drag-surface').trigger('dragover', { dataTransfer, clientX, clientY })
      expect(wrapper.findAll('.tab-drop-preview')).toHaveLength(1)
      expect(wrapper.get('.tab-drop-preview').classes()).toContain(direction)
      expect(wrapper.get('.tab-drop-overlay').text()).toBe('')
    }
    await wrapper.get('.tabs-bar').trigger('dragover', { dataTransfer, clientX: 300, clientY: 190 })
    expect(wrapper.find('.tab-drop-preview').exists()).toBe(false)
    expect(wrapper.find('.split-drop-zones').exists()).toBe(false)
  })

  it('ignores interior block/text/file drags and forged tab transfers', async () => {
    const { wrapper } = fixture()
    for (const type of ['text/plain', 'application/x-prosemirror', TAB_DRAG_MIME]) {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData(type, 'not-an-active-tab-drag')
      const event = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: 300,
        clientY: 790
      })
      wrapper.get('.editor-group-body').element.dispatchEvent(event)
      await nextTick()
      expect(event.defaultPrevented).toBe(false)
      expect(wrapper.find('.tab-drop-preview').exists()).toBe(false)
      expect(wrapper.find('.tab-drag-surface').exists()).toBe(false)
    }
  })

  it('does not flicker between descendants and clears when leaving the group', async () => {
    const { wrapper } = fixture()
    const dataTransfer = await start(wrapper)
    await wrapper
      .get('.tab-drag-surface')
      .trigger('dragover', { dataTransfer, clientX: 300, clientY: 790 })
    await wrapper
      .get('.tab-drag-surface')
      .trigger('dragleave', { relatedTarget: wrapper.get('.tab-content').element })
    expect(wrapper.find('.tab-drop-preview').exists()).toBe(true)
    await wrapper.get('.tab-content').trigger('dragleave', { relatedTarget: document.body })
    expect(wrapper.find('.tab-drop-preview').exists()).toBe(false)
  })

  it('moves the original tab when splitting its own group, preserving identity and count', async () => {
    const { wrapper, ids } = fixture()
    const editor = useEditorStore()
    const dataTransfer = await start(wrapper)
    const contentDrop = vi.fn()
    wrapper.get('.tab-drag-surface').element.addEventListener('drop', contentDrop)
    await wrapper
      .get('.tab-drag-surface')
      .trigger('drop', { dataTransfer, clientX: 300, clientY: 790 })
    expect(contentDrop).not.toHaveBeenCalled()
    expect(editor.groups).toHaveLength(2)
    expect(editor.groups[0].tabs.map((tab) => tab.id)).toEqual(ids.slice(1))
    expect(editor.groups[1].tabs.map((tab) => tab.id)).toEqual([ids[0]])
    expect(editor.groups.flatMap((group) => group.tabs)).toHaveLength(3)
    expect(useTabDragStore().tabId).toBeNull()
    expect(wrapper.find('.tab-drop-preview').exists()).toBe(false)
  })

  it('keeps toolbar splitting as a duplicate and rejects moving a lone tab into its own split', () => {
    const editor = useEditorStore()
    const id = editor.openWeb('https://example.com')
    const groupId = editor.activeGroupId
    editor.splitTab(id, groupId, 'bottom', 'move')
    expect(editor.groups).toHaveLength(1)
    editor.splitActive('bottom')
    expect(editor.groups).toHaveLength(2)
    expect(editor.groups[0].tabs[0].id).toBe(id)
    expect(editor.groups[1].tabs[0].id).not.toBe(id)
  })

  it('shows only the destination group preview and merges there on a center drop', async () => {
    const { wrapper: left, ids } = fixture()
    const editor = useEditorStore()
    editor.splitActive('right')
    const rightGroup = editor.activeGroup!
    const right = shallowMount(EditorGroup, { props: { group: rightGroup } })
    wrappers.push(right)
    vi.spyOn(right.get('.editor-group-body').element, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(500, 200, 400, 600)
    )
    const dataTransfer = await start(left)
    await left
      .get('.tab-drag-surface')
      .trigger('dragover', { dataTransfer, clientX: 300, clientY: 790 })
    await right
      .get('.tab-drag-surface')
      .trigger('dragover', { dataTransfer, clientX: 700, clientY: 500 })
    expect(left.find('.tab-drop-preview').exists()).toBe(false)
    expect(right.get('.tab-drop-preview').classes()).toContain('center')
    await right
      .get('.tab-drag-surface')
      .trigger('drop', { dataTransfer, clientX: 700, clientY: 500 })
    expect(editor.groups[0].tabs.map((tab) => tab.id)).toEqual(ids.slice(1))
    expect(editor.groups[1].tabs.map((tab) => tab.id)).toContain(ids[0])
    expect(editor.groups.flatMap((group) => group.tabs)).toHaveLength(4)
    expect(left.find('.tab-drop-preview').exists()).toBe(false)
    expect(right.find('.tab-drop-preview').exists()).toBe(false)
  })

  it('reorders before the target tab without an off-by-one, and does not move a tab dropped on itself', async () => {
    const { wrapper, ids } = fixture()
    const editor = useEditorStore()
    const dataTransfer = await start(wrapper)
    await wrapper.findAll('.tab')[2].trigger('drop', { dataTransfer, clientX: 300, clientY: 170 })
    expect(editor.activeGroup?.tabs.map((tab) => tab.id)).toEqual([ids[1], ids[0], ids[2]])
    const layout = editor.layout
    const secondDrag = await start(wrapper, 1)
    await wrapper
      .findAll('.tab')[1]
      .trigger('drop', { dataTransfer: secondDrag, clientX: 300, clientY: 170 })
    expect(editor.layout).toBe(layout)
  })
})
