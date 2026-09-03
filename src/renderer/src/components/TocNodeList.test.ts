// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeskTocNode } from '../../../shared/contracts'
import TocNodeList from './TocNodeList.vue'

beforeEach(() => {
  setActivePinia(createPinia())
})

const sourceNote: Extract<DeskTocNode, { type: 'note' }> = {
  type: 'note',
  uuid: 'note-a',
  title: '第一篇',
  dirName: '0001. 第一篇',
  noteIndex: '0001',
  tocLineIndex: 1,
  nodeId: 'note-a',
  completed: false,
  children: []
}

const targetNote: Extract<DeskTocNode, { type: 'note' }> = {
  type: 'note',
  uuid: 'note-b',
  title: '第二篇',
  dirName: '0002. 第二篇',
  noteIndex: '0002',
  tocLineIndex: 2,
  nodeId: 'note-b',
  completed: true,
  children: []
}

function mountList(nodes: DeskTocNode[] = [sourceNote, targetNote]): ReturnType<typeof mount> {
  return mount(TocNodeList, {
    props: { nodes, selectedNoteUuid: sourceNote.uuid }
  })
}

function dataTransferStub(): {
  effectAllowed: string
  dropEffect: string
  types: string[]
  setData: (type: string, value: string) => void
  getData: (type: string) => string
  setDragImage: () => void
} {
  const data = new Map<string, string>()
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    types: [] as string[],
    setData(type: string, value: string) {
      data.set(type, value)
      if (!this.types.includes(type)) this.types.push(type)
    },
    getData(type: string) {
      return data.get(type) ?? ''
    },
    setDragImage() {
      return undefined
    }
  }
}

describe('TocNodeList', () => {
  it('keeps only the more menu and add-child controls beside a row', () => {
    const wrapper = mountList()
    const firstRow = wrapper.findAll('.toc-row')[0]

    expect(firstRow.findAll(':scope > .row-action')).toHaveLength(1)
    expect(firstRow.findAll(':scope > .row-menu')).toHaveLength(1)
    expect(firstRow.find('.row-menu summary').attributes('aria-label')).toBe('更多操作')
    expect(firstRow.find('.add-note-action').attributes('aria-label')).toBe('添加子笔记')
    expect(firstRow.find('.row-menu-popover').text()).toContain('在右侧打开')
    expect(firstRow.find('.row-menu-popover').text()).toContain('重命名')
    expect(firstRow.find('.row-menu-popover').text()).toContain('使用 IDE 打开')
    expect(firstRow.find('.row-menu-popover').text()).toContain('永久删除')
  })

  it('emits an inside move when a note is dropped in the middle of another row', async () => {
    const wrapper = mountList()
    const rows = wrapper.findAll('.toc-row')
    const transfer = dataTransferStub()
    const targetElement = rows[1].element as HTMLElement
    Object.defineProperty(targetElement, 'offsetHeight', { configurable: true, value: 30 })
    targetElement.getBoundingClientRect = () =>
      ({ top: 0, bottom: 30, left: 0, right: 200, width: 200, height: 30, x: 0, y: 0 }) as DOMRect

    await rows[0].trigger('dragstart', { dataTransfer: transfer })
    await rows[1].trigger('dragover', { clientY: 15, dataTransfer: transfer })
    expect(rows[1].classes()).toContain('drop-inside')
    await rows[1].trigger('drop', { clientY: 15, dataTransfer: transfer })

    expect(wrapper.emitted('move')).toEqual([[sourceNote, targetNote, 'inside']])
  })

  it('does not move a group into one of its descendants', async () => {
    const group: Extract<DeskTocNode, { type: 'group' }> = {
      type: 'group',
      title: '分组',
      tocLineIndex: 0,
      nodeId: 'group-a',
      folderPath: ['分组'],
      children: [targetNote]
    }
    const wrapper = mountList([group])
    const rows = wrapper.findAll('.toc-row')
    const transfer = dataTransferStub()
    const targetElement = rows[1].element as HTMLElement
    Object.defineProperty(targetElement, 'offsetHeight', { configurable: true, value: 30 })
    targetElement.getBoundingClientRect = () =>
      ({ top: 0, bottom: 30, left: 0, right: 200, width: 200, height: 30, x: 0, y: 0 }) as DOMRect

    await rows[0].trigger('dragstart', { dataTransfer: transfer })
    await rows[1].trigger('dragover', { clientY: 15, dataTransfer: transfer })
    await rows[1].trigger('drop', { clientY: 15, dataTransfer: transfer })

    expect(wrapper.emitted('move')).toBeUndefined()
  })

  it('keeps a note open on double click instead of requesting a rename', async () => {
    const wrapper = mountList()

    await wrapper.find('.node-label:not(.group)').trigger('dblclick')

    expect(wrapper.emitted('selectPermanent')).toEqual([[sourceNote]])
    expect(wrapper.emitted('requestRename')).toBeUndefined()
  })

  it('shows note path, Finder, pin and IDE actions on right click', async () => {
    const wrapper = mountList()

    await wrapper.find('.toc-row').trigger('contextmenu', { clientX: 40, clientY: 60 })

    const menu = document.body.querySelector('.note-context-menu')
    expect(menu?.textContent).toContain('复制路径')
    expect(menu?.textContent).toContain('在 Finder 中显示')
    expect(menu?.textContent).toContain('固定')
    expect(menu?.textContent).toContain('使用 IDE 打开')
    expect(wrapper.emitted('openIde')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not request a rename when double-clicking a group', async () => {
    const group: Extract<DeskTocNode, { type: 'group' }> = {
      type: 'group',
      title: '分组',
      tocLineIndex: 0,
      nodeId: 'group-a',
      folderPath: ['分组'],
      children: [sourceNote]
    }
    const wrapper = mountList([group])

    await wrapper.find('.node-label.group').trigger('dblclick')

    expect(wrapper.emitted('requestRename')).toBeUndefined()
  })

  it('expands collapsed parents when a focused note is requested', async () => {
    const group: Extract<DeskTocNode, { type: 'group' }> = {
      type: 'group',
      title: '分组',
      tocLineIndex: 0,
      nodeId: 'group-a',
      folderPath: ['分组'],
      children: [targetNote]
    }
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
    const wrapper = mount(TocNodeList, {
      props: { nodes: [group], selectedNoteUuid: null, focusRequestId: 0 }
    })

    await wrapper.find('.disclosure').trigger('click')
    expect(wrapper.find('[data-note-uuid="note-b"]').exists()).toBe(false)

    await wrapper.setProps({ selectedNoteUuid: targetNote.uuid, focusRequestId: 1 })
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())

    expect(wrapper.find('[data-note-uuid="note-b"]').exists()).toBe(true)
  })
})
