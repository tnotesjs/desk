// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MilkdownMarkdownEditor from './MilkdownMarkdownEditor.vue'

interface EditorHandle {
  insertTextAt(text: string, position?: number): void
}

async function mountEditor(
  content = 'alpha\n',
  props: Partial<InstanceType<typeof MilkdownMarkdownEditor>['$props']> = {}
): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(MilkdownMarkdownEditor, {
    attachTo: document.body,
    props: {
      content,
      mode: 'visual',
      readOnly: false,
      knowledgeBaseId: 'kb-a',
      noteUuid: 'note-a',
      active: true,
      uploadImage: vi.fn(async () => ({ src: './assets/image.png', alt: 'image' })),
      ...props
    }
  })
  await vi.waitFor(() => expect(wrapper.find('.ProseMirror').exists()).toBe(true))
  return wrapper
}

describe('MilkdownMarkdownEditor synchronization', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('does not emit a change while creating or replacing external content', async () => {
    const wrapper = await mountEditor()
    expect(wrapper.emitted('change')).toBeUndefined()

    await wrapper.setProps({ content: 'external\n' })
    await Promise.resolve()

    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })

  it('flushes a transaction synchronously when the view is immediately unmounted', async () => {
    const wrapper = await mountEditor()
    const editor = wrapper.vm as unknown as EditorHandle

    editor.insertTextAt('typed')
    wrapper.unmount()

    const changes = wrapper.emitted<string[]>('change') ?? []
    expect(changes).toHaveLength(1)
    expect(changes[0][0]).toContain('typed')
  })

  it('emits user transactions without Milkdown listener debounce', async () => {
    const wrapper = await mountEditor()
    const editor = wrapper.vm as unknown as EditorHandle

    editor.insertTextAt('now')
    await Promise.resolve()

    const changes = wrapper.emitted<string[]>('change') ?? []
    expect(changes).toHaveLength(1)
    expect(changes[0][0]).toContain('now')
    wrapper.unmount()
  })

  it('keeps opaque reference definitions when editing another block', async () => {
    const source = 'See [guide].\n\nparagraph\n\n[guide]: https://example.com/docs\n'
    const wrapper = await mountEditor(source)
    const editor = wrapper.vm as unknown as EditorHandle

    editor.insertTextAt('new block')
    await Promise.resolve()

    const changes = wrapper.emitted<string[]>('change') ?? []
    expect(changes.at(-1)?.[0]).toContain('[guide]: https://example.com/docs')
    wrapper.unmount()
  })

  it('treats the readonly view mode as effectively read-only', async () => {
    const wrapper = await mountEditor('alpha\n', { mode: 'readonly', readOnly: false })
    const editor = wrapper.vm as unknown as EditorHandle

    expect(wrapper.get('.ProseMirror').attributes('contenteditable')).toBe('false')
    editor.insertTextAt('blocked')
    await Promise.resolve()

    expect(wrapper.emitted('change')).toBeUndefined()
    await wrapper.setProps({ mode: 'visual' })
    await vi.waitFor(() =>
      expect(wrapper.get('.ProseMirror').attributes('contenteditable')).toBe('true')
    )
    wrapper.unmount()
  })

  it('renders local images through the asset protocol without emitting a source rewrite', async () => {
    const source = '![图片](./assets/%E5%9B%BE%20%E7%89%87.png)\n'
    const wrapper = await mountEditor(source, {
      knowledgeBaseId: 'kb/一',
      noteUuid: 'note 1'
    })
    const image = wrapper.get('.ProseMirror img')
    const renderedSource = image.attributes('src') ?? ''

    expect(renderedSource).toContain('tnotes-asset://asset?')
    const url = new URL(renderedSource)
    expect(url.searchParams.get('knowledgeBaseId')).toBe('kb/一')
    expect(url.searchParams.get('noteUuid')).toBe('note 1')
    expect(url.searchParams.get('path')).toBe('./assets/%E5%9B%BE%20%E7%89%87.png')
    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })

  it('opens links directly in readonly mode and requires a modifier while editing', async () => {
    const readonly = await mountEditor('[Open](https://example.com)\n', { mode: 'readonly' })
    await readonly.get('.ProseMirror a').trigger('click')
    expect(readonly.emitted<string[]>('openLink')).toEqual([['https://example.com']])
    readonly.unmount()

    const visual = await mountEditor('[Open](https://example.com)\n')
    await visual.get('.ProseMirror a').trigger('click')
    expect(visual.emitted('openLink')).toBeUndefined()
    await visual.get('.ProseMirror a').trigger('click', { ctrlKey: true })
    expect(visual.emitted<string[]>('openLink')).toEqual([['https://example.com']])
    visual.unmount()
  })

  it('scrolls hash links inside the current document instead of opening a web tab', async () => {
    const wrapper = await mountEditor('[Jump](#heading)\n\n## Heading\n')
    const heading = wrapper.get('.ProseMirror h2')
    const scrollIntoView = vi.fn()
    Object.defineProperty(heading.element, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })

    await wrapper.get('.ProseMirror a').trigger('click')

    expect(heading.attributes('id')).toBe('heading')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(wrapper.emitted('openLink')).toBeUndefined()
    wrapper.unmount()
  })

  it('resolves TOC anchors even when Milkdown heading ids diverge from canonical slugs', async () => {
    // Milkdown slugs `1. 本节内容` as `1.-本节内容`, while the TOC region (generated
    // by github-slugger) links to `#1-本节内容`. The click handler must locate the
    // heading by its canonical slug as a fallback.
    const source = [
      '# [0001. hello-algo](https://example.com)',
      '',
      '<!-- region:toc -->',
      '- [1. 本节内容](#1-本节内容)',
      '- [3. `hello-algo` 是什么？](#3-hello-algo-是什么)',
      '<!-- endregion:toc -->',
      '',
      '## 1. 本节内容',
      '',
      '正文',
      '',
      '## 3. `hello-algo` 是什么？',
      '',
      '内容',
      ''
    ].join('\n')
    const wrapper = await mountEditor(source)
    const headings = wrapper.findAll('.ProseMirror h2')
    const scrollIntoView = vi.fn()
    headings.forEach((heading) =>
      Object.defineProperty(heading.element, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView
      })
    )

    const anchors = wrapper.findAll('.ProseMirror a[href^="#"]')
    expect(anchors.length).toBeGreaterThan(0)

    // Guard the regression: Milkdown's own heading id must differ from the TOC
    // anchor for this exercise to prove the canonical-slug fallback is in use.
    const tocFirstHref = anchors[0].attributes('href')
    const headingIds = headings.map((heading) => heading.attributes('id'))
    expect(tocFirstHref).toBe('#1-本节内容')
    expect(headingIds).toContain('1.-本节内容')
    expect(headingIds).not.toContain('1-本节内容')

    const firstAnchor = anchors[0]
    await firstAnchor.trigger('click')

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(wrapper.emitted('openLink')).toBeUndefined()
    wrapper.unmount()
  })

  it('renders reference-style links as links and hides the definition atom', async () => {
    const source = [
      '## 5. 引用',
      '',
      '- [hello 算法 github 仓库][1]',
      '- [hello 算法在线阅读][2]',
      '',
      '[1]: https://github.com/krahets/hello-algo',
      '[2]: https://www.hello-algo.com/',
      ''
    ].join('\n')
    const wrapper = await mountEditor(source)
    const pm = wrapper.get('.ProseMirror').element as HTMLElement

    const renderedLinks = [...pm.querySelectorAll('a')].map((anchor) => ({
      href: anchor.getAttribute('href'),
      text: (anchor.textContent ?? '').trim()
    }))
    expect(renderedLinks).toEqual([
      { href: 'https://github.com/krahets/hello-algo', text: 'hello 算法 github 仓库' },
      { href: 'https://www.hello-algo.com/', text: 'hello 算法在线阅读' }
    ])

    // The reference definitions must not surface as visible source cards.
    expect(pm.querySelectorAll('.desk-raw-block:not(.desk-raw-block--hidden)')).toHaveLength(0)
    expect(pm.querySelectorAll('.desk-raw-block--hidden')).toHaveLength(1)
    wrapper.unmount()
  })
})
