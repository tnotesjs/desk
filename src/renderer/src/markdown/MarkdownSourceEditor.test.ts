// @vitest-environment happy-dom

import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MarkdownSourceEditor from './MarkdownSourceEditor.vue'

interface EditorHandle {
  insertTextAt(text: string, position?: number): void
  wrapSelection(prefix: string, suffix: string, placeholder?: string): void
  prefixSelection(prefix: string): void
  setLinePrefix(prefix: string): void
}

function mountEditor(
  content = 'alpha',
  props: Partial<InstanceType<typeof MarkdownSourceEditor>['$props']> = {}
): VueWrapper {
  return mount(MarkdownSourceEditor, {
    attachTo: document.body,
    props: {
      content,
      mode: 'source',
      readOnly: false,
      knowledgeBaseId: 'kb-a',
      noteUuid: 'note-a',
      active: true,
      ...props
    }
  })
}

function editorHandle(wrapper: VueWrapper): EditorHandle {
  return wrapper.vm as unknown as EditorHandle
}

function editorText(wrapper: VueWrapper): string {
  return wrapper.find('.cm-content').text()
}

describe('MarkdownSourceEditor', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.body.replaceChildren()
  })

  it('does not emit change for initial or externally synchronized content', async () => {
    const wrapper = mountEditor()

    expect(editorText(wrapper)).toBe('alpha')
    expect(wrapper.emitted('change')).toBeUndefined()

    await wrapper.setProps({ content: 'external\ncontent' })

    expect(editorText(wrapper)).toContain('external')
    expect(editorText(wrapper)).toContain('content')
    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps the formatting toolbar interface and emits exact Markdown edits', () => {
    const insertion = mountEditor()
    editorHandle(insertion).insertTextAt('!', 5)
    expect(insertion.emitted<string[]>('change')?.at(-1)?.[0]).toBe('alpha!')
    insertion.unmount()

    const inline = mountEditor()
    editorHandle(inline).wrapSelection('**', '**')
    expect(inline.emitted<string[]>('change')?.at(-1)?.[0]).toBe('**文字**alpha')
    inline.unmount()

    const block = mountEditor()
    editorHandle(block).setLinePrefix('## ')
    expect(block.emitted<string[]>('change')?.at(-1)?.[0]).toBe('## alpha')
    block.unmount()

    const quoted = mountEditor('one\ntwo')
    editorHandle(quoted).prefixSelection('> ')
    expect(quoted.emitted<string[]>('change')?.at(-1)?.[0]).toBe('> one\ntwo')
    quoted.unmount()
  })

  it('retains the Markdown formatting keymap', async () => {
    const wrapper = mountEditor()
    const content = wrapper.get('.cm-content').element
    const keyOptions =
      navigator.platform.toLowerCase().includes('mac') ||
      navigator.userAgent.toLowerCase().includes('mac')
        ? { metaKey: true }
        : { ctrlKey: true }

    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true, ...keyOptions })
    )
    await Promise.resolve()

    expect(wrapper.emitted<string[]>('change')?.at(-1)?.[0]).toBe('**文字**alpha')
    wrapper.unmount()
  })

  it('blocks exposed methods and keyboard editing while read-only', () => {
    const wrapper = mountEditor('alpha', { readOnly: true })

    editorHandle(wrapper).insertTextAt('blocked')
    editorHandle(wrapper).wrapSelection('**', '**')
    editorHandle(wrapper).setLinePrefix('# ')

    expect(editorText(wrapper)).toBe('alpha')
    expect(wrapper.emitted('change')).toBeUndefined()
    expect(wrapper.get('.cm-content').attributes('contenteditable')).toBe('false')
    wrapper.unmount()
  })

  it('reconfigures its CodeMirror theme when the app appearance changes', async () => {
    document.documentElement.dataset.theme = 'light'
    const wrapper = mountEditor()
    const editor = wrapper.get('.cm-editor')
    const lightClasses = editor.attributes('class')

    document.documentElement.dataset.theme = 'dark'

    await vi.waitFor(() => expect(editor.attributes('class')).not.toBe(lightClasses))
    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })

  it('emits pasted images at the current source position', () => {
    const wrapper = mountEditor()
    const transfer = new DataTransfer()
    const image = new File(['image'], 'paste.png', { type: 'image/png' })
    transfer.items.add(image)
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    })

    wrapper.get('.cm-content').element.dispatchEvent(event)

    const pasted = wrapper.emitted<[File, number]>('pasteImage')
    expect(pasted).toHaveLength(1)
    expect(pasted?.[0][0]).toBe(image)
    expect(pasted?.[0][1]).toBe(0)
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })
})
