// @vitest-environment happy-dom

import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeBaseDescriptor } from '../../../shared/contracts'
import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'
import EditorGroup from './EditorGroup.vue'

const knowledgeBase: KnowledgeBaseDescriptor = {
  id: 'kb-a',
  configId: 'docs',
  name: 'docs',
  rootPath: '/tmp/docs',
  displayName: 'docs',
  icon: null,
  health: 'ready',
  diagnostics: [],
  noteCount: 2,
  snapshotRevision: 'v1'
}
const showContextMenu = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  showContextMenu.mockReset().mockResolvedValue({ ok: true, value: null })
  Object.defineProperty(window, 'desk', { configurable: true, value: { app: { showContextMenu } } })
})
afterEach(() => Reflect.deleteProperty(window, 'desk'))

describe('native tab context menu', () => {
  it('closes the right-clicked tab through the unsaved-change guard, not the active tab', async () => {
    const editor = useEditorStore()
    const workspace = useWorkspaceStore()
    const a = editor.openNote(knowledgeBase, 'a', 'A', 'visual', undefined, 'permanent')
    const b = editor.openNote(knowledgeBase, 'b', 'B', 'visual', undefined, 'permanent')
    const close = vi.spyOn(workspace, 'requestCloseTab').mockResolvedValue(false)
    const wrapper = shallowMount(EditorGroup, { props: { group: editor.activeGroup! } })
    showContextMenu.mockResolvedValue({ ok: true, value: 'close' })
    await wrapper.findAll('.tab')[0].trigger('contextmenu')
    await flushPromises()
    expect(showContextMenu).toHaveBeenCalledExactlyOnceWith({
      kind: 'tab',
      tabType: 'note',
      pinned: false
    })
    expect(close).toHaveBeenCalledExactlyOnceWith(a)
    expect(editor.activeTab?.id).toBe(b)
    expect(editor.activeGroup?.tabs).toHaveLength(2)
    expect(wrapper.find('.tab-context-menu').exists()).toBe(false)
    wrapper.unmount()
  })

  it('leaves a pinned file tab unchanged when the native menu is dismissed', async () => {
    const editor = useEditorStore()
    const workspace = useWorkspaceStore()
    editor.switchKnowledgeBase(knowledgeBase.id)
    const id = editor.openNoteFile(knowledgeBase, 'a', 'A', 'demo.js', 'text')
    editor.setPinned(id, true)
    const close = vi.spyOn(workspace, 'requestCloseTab').mockResolvedValue(false)
    const wrapper = shallowMount(EditorGroup, { props: { group: editor.activeGroup! } })
    await wrapper.find('.tab').trigger('contextmenu')
    await flushPromises()
    expect(showContextMenu).toHaveBeenCalledExactlyOnceWith({
      kind: 'tab',
      tabType: 'note-file',
      pinned: true
    })
    expect(close).not.toHaveBeenCalled()
    expect(editor.activeTab).toMatchObject({ id, pinned: true })
    wrapper.unmount()
  })

  it('routes batch close through the shared confirmation flow', async () => {
    const editor = useEditorStore()
    const workspace = useWorkspaceStore()
    editor.openNote(knowledgeBase, 'a', 'A', 'visual', undefined, 'permanent')
    const close = vi.spyOn(workspace, 'requestCloseTabs').mockResolvedValue(false)
    const wrapper = shallowMount(EditorGroup, { props: { group: editor.activeGroup! } })
    showContextMenu.mockResolvedValue({ ok: true, value: 'close-all' })
    await wrapper.find('.tab').trigger('contextmenu')
    await flushPromises()
    expect(close).toHaveBeenCalledExactlyOnceWith('all')
    wrapper.unmount()
  })
})
