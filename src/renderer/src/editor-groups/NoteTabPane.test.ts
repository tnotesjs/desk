// @vitest-environment happy-dom

import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteEditorTab } from '../../../shared/contracts'
import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'
import NoteTabPane from './NoteTabPane.vue'

vi.mock('../markdown/MilkdownMarkdownEditor.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../markdown/MarkdownSourceEditor.vue', () => ({ default: { template: '<div />' } }))

const tab: NoteEditorTab = {
  id: 'tab-a',
  type: 'note',
  knowledgeBaseId: 'kb-a',
  knowledgeBaseName: 'docs',
  icon: null,
  noteUuid: 'note-a',
  title: '概述',
  viewMode: 'visual',
  pageWidth: 'standard',
  dirty: false,
  pinned: false
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(readOnly = false) {
  const workspace = useWorkspaceStore()
  workspace.documents['kb-a:note-a'] = {
    document: {
      knowledgeBaseId: 'kb-a',
      uuid: 'note-a',
      index: '0001',
      title: '概述',
      dirName: '0001. 概述',
      directoryPath: '/tmp/0001. 概述',
      readmePath: '/tmp/0001. 概述/README.md',
      configPath: '/tmp/0001. 概述/.tnotes.json',
      content: '## 概述',
      revision: 'v1',
      config: {},
      readOnly
    },
    content: '## 概述',
    dirty: false,
    saving: false,
    externalConflict: false,
    preserveSourceOnSave: false
  }
  const rename = vi.spyOn(workspace, 'renameNote').mockResolvedValue()
  const wrapper = shallowMount(NoteTabPane, {
    attachTo: document.body,
    props: { tab: { ...tab }, groupId: 'group-a', active: true },
    global: { renderStubDefaultSlot: true }
  })
  return { wrapper, workspace, rename, editor: useEditorStore() }
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => document.body.replaceChildren())

describe('note header', () => {
  it('puts width before the divider and view modes, with a separate visual-only formatting row', async () => {
    const { wrapper, editor } = setup()
    const controls = wrapper.get('.view-controls')
    expect(controls.findAll('button').map((button) => button.attributes('aria-label'))).toEqual([
      '标准页宽',
      '可视化编辑',
      '只读视图',
      '源码视图'
    ])
    expect(controls.element.children[1].className).toBe('view-divider')
    expect(wrapper.get('.document-toolbar').find('.format-actions').exists()).toBe(false)
    expect(wrapper.get('.document-toolbar').element.nextElementSibling?.className).toBe(
      'format-actions'
    )
    expect(wrapper.find('.save-button').exists()).toBe(false)
    const width = vi.spyOn(editor, 'toggleNotePageWidth')
    const view = vi.spyOn(editor, 'setNoteViewMode')
    await wrapper.get('.page-width-toggle').trigger('click')
    await wrapper.get('[aria-label="源码视图"]').trigger('click')
    expect(width).toHaveBeenCalledWith('tab-a')
    expect(view).toHaveBeenCalledWith('tab-a', 'source')
    for (const viewMode of ['source', 'readonly', 'visual'] as const) {
      await wrapper.setProps({ tab: { ...tab, viewMode } })
      expect(wrapper.find('.format-actions').exists()).toBe(viewMode === 'visual')
      expect(wrapper.find('.view-controls').exists()).toBe(true)
      expect(wrapper.find('.save-button').exists()).toBe(false)
    }
    wrapper.unmount()
  })

  it('edits only the title and submits a trimmed name on blur', async () => {
    const { wrapper, rename } = setup()
    await wrapper.get('.note-title-button').trigger('click')
    const input = wrapper.get('input')
    expect(input.element.value).toBe('概述')
    expect(document.activeElement).toBe(input.element)
    expect(input.element.selectionEnd).toBe(2)
    expect(wrapper.get('.note-index').text()).toBe('0001.')
    await input.setValue('  新的名称  ')
    expect(rename).not.toHaveBeenCalled()
    await input.trigger('blur')
    await flushPromises()
    expect(rename).toHaveBeenCalledExactlyOnceWith('kb-a', 'note-a', '新的名称')
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['', '   ', '  概述  '])('ignores empty or unchanged titles: %j', async (value) => {
    const { wrapper, rename } = setup()
    await wrapper.get('.note-title-button').trigger('click')
    await wrapper.get('input').setValue(value)
    await wrapper.get('input').trigger('blur')
    expect(rename).not.toHaveBeenCalled()
    expect(wrapper.get('.note-title-button').text()).toBe('概述')
    wrapper.unmount()
  })

  it('cancels with Escape and ignores IME Enter until composition ends', async () => {
    const { wrapper, rename } = setup()
    await wrapper.get('.note-title-button').trigger('click')
    await wrapper.get('input').setValue('取消修改')
    await wrapper.get('input').trigger('keydown', { key: 'Escape' })
    expect(rename).not.toHaveBeenCalled()
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.get('.note-title-button').trigger('click')
    await wrapper.get('input').setValue('确认修改')
    await wrapper.get('input').trigger('keydown', { key: 'Enter', isComposing: true })
    expect(rename).not.toHaveBeenCalled()
    expect(wrapper.find('input').exists()).toBe(true)
    await wrapper.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(rename).toHaveBeenCalledExactlyOnceWith('kb-a', 'note-a', '确认修改')
    wrapper.unmount()
  })

  it('reports rename failures and leaves the original title intact', async () => {
    const { wrapper, rename, workspace } = setup()
    rename.mockRejectedValue(new Error('名称不合法'))
    await wrapper.get('.note-title-button').trigger('click')
    await wrapper.get('input').setValue('invalid/name')
    await wrapper.get('input').trigger('blur')
    await flushPromises()
    expect(workspace.error).toBe('名称不合法')
    expect(wrapper.get('.note-title-button').text()).toBe('概述')
    expect(wrapper.get('.note-title-button').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not rename a read-only document', async () => {
    const { wrapper, rename } = setup(true)
    expect(wrapper.get('.note-title-button').attributes('disabled')).toBeDefined()
    await wrapper.get('.note-title-button').trigger('click')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(rename).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
