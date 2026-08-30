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

  it('opens a structured title+body editor for tip/info/details callouts', async () => {
    const wrapper = await mountWithContainer()
    const edit = wrapper.find('.desk-raw-block__edit')
    expect(edit.classes()).toContain('desk-raw-block__edit--pill')
    expect(edit.text()).toContain('Edit')
    expect(edit.find('svg').exists()).toBe(true)
    await edit.trigger('click')

    expect(wrapper.find('.desk-raw-block__editor--structured').exists()).toBe(true)
    expect(wrapper.find('.desk-raw-block__editor-header').exists()).toBe(false)
    expect(wrapper.find('.desk-raw-block__editor-title-label').exists()).toBe(false)
    expect(wrapper.find('.desk-raw-block__editor-body-label').exists()).toBe(false)
    const title = wrapper.find('.desk-raw-block__editor-title')
    expect(title.exists()).toBe(true)
    expect(title.attributes('placeholder')).toBe('可选标题')
    const done = wrapper.find('.desk-raw-block__editor--structured > .desk-raw-block__editor-done')
    expect(done.classes()).toContain('desk-raw-block__edit--pill')
    expect(done.text()).toContain('Done')
    expect(done.find('svg').exists()).toBe(true)
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

  it('keeps full source editing for swiper containers', async () => {
    const wrapper = await mountSwiper()
    const edit = wrapper.find('.desk-raw-block__edit')
    expect(edit.text()).toBe('编辑源码')
    await edit.trigger('click')
    expect(wrapper.find('.desk-raw-block__editor--structured').exists()).toBe(false)
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

  it('auto-commits structured editor when focus leaves the editor', async () => {
    const wrapper = await mountWithContainer()
    await wrapper.find('.desk-raw-block__edit').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('.desk-raw-block__editor-cm .cm-editor').exists()).toBe(true)
    })
    // Let the post-open focus() settle before leaving the editor.
    await new Promise((resolve) => setTimeout(resolve, 20))

    const editor = wrapper.find('.desk-raw-block__editor--structured').element
    const outside = document.createElement('button')
    document.body.append(outside)
    editor.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: outside, cancelable: true })
    )

    await vi.waitFor(() => {
      expect(wrapper.find('.desk-raw-block__editor').isVisible()).toBe(false)
    })
    outside.remove()
    wrapper.unmount()
  })

  it('keeps structured editor open when focus moves between title and body', async () => {
    const wrapper = await mountWithContainer()
    await wrapper.find('.desk-raw-block__edit').trigger('click')
    const title = wrapper.find('.desk-raw-block__editor-title').element as HTMLInputElement
    const cm = wrapper.find('.desk-raw-block__editor-cm .cm-content').element as HTMLElement
    title.focus()
    title.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: cm, cancelable: true })
    )
    cm.focus()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wrapper.find('.desk-raw-block__editor').isVisible()).toBe(true)
    wrapper.unmount()
  })

  it('closes and disables the inline source editor when switching to readonly', async () => {
    const wrapper = await mountWithContainer()
    await wrapper.find('.desk-raw-block__edit').trigger('click')
    expect(wrapper.find('.desk-raw-block__editor-cm .cm-editor').exists()).toBe(true)

    await wrapper.setProps({ mode: 'readonly' })
    await vi.waitFor(() => {
      expect(wrapper.find('.desk-raw-block__editor').isVisible()).toBe(false)
    })
    const edit = wrapper.get('.desk-raw-block__edit')
    expect(edit.attributes('hidden')).toBeDefined()
    expect(edit.attributes('disabled')).toBeDefined()
    await edit.trigger('click')
    expect(wrapper.find('.desk-raw-block__editor-cm .cm-editor').exists()).toBe(false)
    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })
})
