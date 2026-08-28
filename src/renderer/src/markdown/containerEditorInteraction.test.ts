// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MilkdownMarkdownEditor from './MilkdownMarkdownEditor.vue'

const CONTAINER_SOURCE = '::: details\n\nbody\n\n:::\n\nplain\n'

async function mountWithContainer(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(MilkdownMarkdownEditor, {
    attachTo: document.body,
    props: {
      content: CONTAINER_SOURCE,
      mode: 'visual',
      readOnly: false,
      knowledgeBaseId: 'kb-a',
      noteUuid: 'note-a',
      active: true,
      uploadImage: vi.fn(async () => ({ src: './assets/image.png', alt: 'image' }))
    }
  })
  await vi.waitFor(() => expect(wrapper.find('.ProseMirror').exists()).toBe(true))
  await vi.waitFor(() => expect(wrapper.find('.desk-raw-block__edit').exists()).toBe(true))
  return wrapper
}

async function mountSwiper(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(MilkdownMarkdownEditor, {
    attachTo: document.body,
    props: {
      content: '::: swiper\n\n![1](https://cdn.example/1.png)\n\n:::\n',
      mode: 'visual',
      readOnly: false,
      knowledgeBaseId: 'kb-a',
      noteUuid: 'note-a',
      active: true,
      uploadImage: vi.fn(async () => ({ src: './assets/image.png', alt: 'image' }))
    }
  })
  await vi.waitFor(() => expect(wrapper.find('.ProseMirror').exists()).toBe(true))
  await vi.waitFor(() => expect(wrapper.find('.desk-raw-block__edit').exists()).toBe(true))
  return wrapper
}

describe('container inline source editor', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('opens a single CodeMirror editor and compacts the edit button', async () => {
    const wrapper = await mountWithContainer()
    const edit = wrapper.find('.desk-raw-block__edit')
    await edit.trigger('click')

    expect(wrapper.find('.desk-raw-block__editor').exists()).toBe(true)
    expect(wrapper.find('.desk-raw-block__editor-cm .cm-editor').exists()).toBe(true)
    expect(edit.attributes('hidden')).toBeDefined()
    wrapper.unmount()
  })

  it('does not duplicate the editor when the edit button is clicked repeatedly', async () => {
    const wrapper = await mountWithContainer()
    const edit = wrapper.find('.desk-raw-block__edit')
    await edit.trigger('click')
    await edit.trigger('click')
    await edit.trigger('click')

    expect(wrapper.findAll('.desk-raw-block__editor-cm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('opens the CodeMirror editor for a swiper container', async () => {
    const wrapper = await mountSwiper()
    await wrapper.find('.desk-raw-block__edit').trigger('click')
    expect(wrapper.find('.desk-raw-block__editor-cm .cm-editor').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens the CodeMirror editor for a mermaid diagram atom', async () => {
    const wrapper = mount(MilkdownMarkdownEditor, {
      attachTo: document.body,
      props: {
        content: '```mermaid\nflowchart TD\n  A --> B\n```\n',
        mode: 'visual',
        readOnly: false,
        knowledgeBaseId: 'kb-a',
        noteUuid: 'note-a',
        active: true,
        uploadImage: vi.fn(async () => ({ src: './assets/image.png', alt: 'image' }))
      }
    })
    await vi.waitFor(() => expect(wrapper.find('.ProseMirror').exists()).toBe(true))
    await vi.waitFor(() => expect(wrapper.find('.desk-raw-block__edit').exists()).toBe(true))
    await wrapper.find('.desk-raw-block__edit').trigger('click')
    expect(wrapper.find('.desk-raw-block__editor-cm .cm-editor').exists()).toBe(true)
    expect(wrapper.find('.desk-raw-block--diagram .desk-diagram').exists()).toBe(true)
    wrapper.unmount()
  })

  it('collapses the editor when 完成 is clicked without changes', async () => {
    const wrapper = await mountWithContainer()
    await wrapper.find('.desk-raw-block__edit').trigger('click')
    await wrapper.find('.desk-raw-block__editor-done').trigger('click')
    await vi.waitFor(() => {
      const editor = wrapper.find('.desk-raw-block__editor')
      expect(editor.isVisible()).toBe(false)
    })
    wrapper.unmount()
  })
})
