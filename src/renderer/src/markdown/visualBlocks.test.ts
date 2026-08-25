// @vitest-environment happy-dom

import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it } from 'vitest'

import { collectVisualBlocks, renderVisualBlock } from './visualBlocks'
import { visualMarkdownExtensions } from './visualExtension'

const context = { knowledgeBaseId: 'knowledge/base', noteUuid: 'note-1' }

describe('visual Markdown blocks', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('collects generated and editable block types without changing their source', () => {
    const source = [
      '# 0001. 标题',
      '',
      '<!-- region:toc -->',
      '- [章节](#章节)',
      '<!-- endregion:toc -->',
      '',
      '## 章节',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```ts',
      'const answer = 42',
      '```'
    ].join('\n')
    const blocks = collectVisualBlocks(source)

    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'generated',
      'heading',
      'table',
      'code'
    ])
    expect(blocks.filter((block) => block.generated)).toHaveLength(2)
    expect(blocks.map((block) => block.source).join('\n\n')).toBe(source)
  })

  it('rewrites local images through the restricted asset protocol and sanitizes HTML', () => {
    const [block] = collectVisualBlocks(
      '![示例](./assets/demo.png)\n\n<img src="javascript:alert(1)" onerror="alert(1)" style="color: red">'
    )
    const html = renderVisualBlock(block, context)

    expect(html).toContain('tnotes-asset://asset?')
    expect(html).toContain('knowledgeBaseId=knowledge%2Fbase')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('style=')
  })

  it('resolves reference-style links from definitions elsewhere in the document', () => {
    const source = '- [TNotes][1]\n\n[1]: https://tnotesjs.github.io/TNotes/'
    const [links] = collectVisualBlocks(source)
    const html = renderVisualBlock(links, context, source)

    expect(html).toContain('href="https://tnotesjs.github.io/TNotes/"')
    expect(html).toContain('>TNotes</a>')
    expect(html).not.toContain('[1]')
  })

  it('protects generated H1 content while allowing ordinary paragraph edits', () => {
    const source = '# 0001. 标题\n\n正文'
    const state = EditorState.create({
      doc: source,
      extensions: visualMarkdownExtensions(context, () => undefined)
    })

    const blocked = state.update({ changes: { from: 2, to: 6, insert: '9999' } })
    expect(blocked.state.doc.toString()).toBe(source)

    const paragraphStart = source.indexOf('正文')
    const allowed = state.update({
      changes: { from: paragraphStart, to: source.length, insert: '更新后的正文' }
    })
    expect(allowed.state.doc.toString()).toContain('更新后的正文')
  })

  it('keeps headings, paragraphs and lists on stable lines while focus reveals Markdown', () => {
    const source = '## 标题\n\n这是 **正文**。\n\n- 列表项'
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), visualMarkdownExtensions(context, () => undefined)]
      })
    })
    const heading = parent.querySelector<HTMLElement>('.cm-visual-live-heading')
    const paragraph = parent.querySelector<HTMLElement>('.cm-visual-live-paragraph')
    const list = parent.querySelector<HTMLElement>('.cm-visual-live-list')

    expect(parent.querySelector('.cm-visual-block')).toBeNull()
    expect(heading?.textContent).toBe('标题')
    expect(paragraph?.textContent).toContain('这是 正文。')
    expect(list?.textContent).toContain('• 列表项')

    view.dispatch({ selection: { anchor: source.indexOf('标题') } })
    view.contentDOM.dispatchEvent(new FocusEvent('focus'))

    expect(parent.querySelector('.cm-visual-live-heading')).toBe(heading)
    expect(parent.querySelector('.cm-visual-live-paragraph')).toBe(paragraph)
    expect(parent.querySelector('.cm-visual-live-list')).toBe(list)
    expect(heading?.textContent).toBe('## 标题')

    view.dispatch({ selection: { anchor: source.indexOf('正文') } })
    expect(parent.querySelector('.cm-visual-live-heading')).toBe(heading)
    expect(parent.querySelector('.cm-visual-live-paragraph')).toBe(paragraph)
    expect(paragraph?.textContent).toContain('这是 **正文**。')
    view.destroy()
  })

  it('keeps rich blocks rendered when the visual editor receives focus', () => {
    const source = '```ts\nconst answer = 42\n```'
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), visualMarkdownExtensions(context, () => undefined)]
      })
    })
    const renderedBlock = parent.querySelector<HTMLElement>('.cm-visual-code')

    expect(renderedBlock?.textContent).toContain('const answer = 42')
    view.dispatch({ selection: { anchor: source.indexOf('answer') } })
    view.contentDOM.dispatchEvent(new FocusEvent('focus'))

    expect(parent.querySelector('.cm-visual-code')).toBe(renderedBlock)
    expect(parent.querySelector('.cm-visual-code')?.textContent).toContain('const answer = 42')
    view.destroy()
  })

  it('navigates generated TOC links to the matching heading', () => {
    const source =
      '<!-- region:toc -->\n- [2. 评价](#2-评价)\n<!-- endregion:toc -->\n\n## 2. 评价\n\n正文'
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          markdown(),
          visualMarkdownExtensions(context, () => undefined, undefined, false)
        ]
      })
    })
    const anchor = parent.querySelector<HTMLAnchorElement>('a')!

    anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(view.state.selection.main.from).toBe(source.indexOf('## 2. 评价'))
    view.destroy()
  })

  it('renders a compact generated TOC that can be collapsed and restores its state', () => {
    const source =
      '<!-- region:toc -->\n- [1. 本节内容](#1-本节内容)\n  - [1.1. 子标题](#11-子标题)\n<!-- endregion:toc -->\n\n## 1. 本节内容\n\n正文'
    const mount = (): { parent: HTMLElement; view: EditorView } => {
      const parent = document.createElement('div')
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: source,
          extensions: [markdown(), visualMarkdownExtensions(context, () => undefined)]
        })
      })
      return { parent, view }
    }
    const first = mount()
    const header = first.parent.querySelector<HTMLButtonElement>('.cm-visual-toc-header')!
    const content = first.parent.querySelector<HTMLElement>('.cm-visual-toc-content')!

    expect(first.parent.querySelectorAll('.cm-visual-toc-item')).toHaveLength(2)
    expect(first.parent.querySelector('.cm-visual-toc-content ul')).toBeNull()
    expect(content.hidden).toBe(false)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    header.click()
    expect(content.hidden).toBe(true)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    first.view.destroy()

    const restored = mount()
    expect(restored.parent.querySelector<HTMLElement>('.cm-visual-toc-content')?.hidden).toBe(true)
    restored.view.destroy()
  })

  it('folds H2 content from the left-side control without changing Markdown', () => {
    const source =
      '## 1. 第一节\n\n第一节正文\n\n### 1.1. 子标题\n\n子标题正文\n\n## 2. 第二节\n\n第二节正文'
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), visualMarkdownExtensions(context, () => undefined)]
      })
    })
    const fold = parent.querySelector<HTMLButtonElement>('.cm-visual-h2-fold')!

    expect(parent.textContent).toContain('第一节正文')
    fold.click()
    expect(parent.textContent).not.toContain('第一节正文')
    expect(parent.textContent).toContain('2. 第二节')
    expect(view.state.doc.toString()).toBe(source)

    parent.querySelector<HTMLButtonElement>('.cm-visual-h2-fold')!.click()
    expect(parent.textContent).toContain('第一节正文')
    view.destroy()
  })

  it('uses the entire H2 row as the read-only folding hot area', () => {
    const source = '## 1. 第一节\n\n第一节正文\n\n## 2. 第二节\n\n第二节正文'
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          markdown(),
          visualMarkdownExtensions(context, () => undefined, undefined, false)
        ]
      })
    })
    const heading = parent.querySelector<HTMLElement>('.cm-visual-h2-foldable')!

    expect(parent.querySelector('.cm-visual-h2-fold')).toBeNull()
    expect(parent.textContent).toContain('第一节正文')
    heading.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(parent.textContent).not.toContain('第一节正文')
    expect(parent.textContent).toContain('2. 第二节')
    view.destroy()
  })

  it('expands a folded H2 before navigating to a nested TOC target', () => {
    const source =
      '<!-- region:toc -->\n- [1. 第一节](#1-第一节)\n  - [1.1. 子标题](#11-子标题)\n<!-- endregion:toc -->\n\n## 1. 第一节\n\n### 1.1. 子标题\n\n子标题正文\n\n## 2. 第二节\n\n第二节正文'
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          markdown(),
          visualMarkdownExtensions(context, () => undefined, undefined, false)
        ]
      })
    })

    parent
      .querySelector<HTMLElement>('.cm-visual-h2-foldable')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(parent.textContent).not.toContain('子标题正文')

    ;[...parent.querySelectorAll<HTMLAnchorElement>('.cm-visual-toc-item a')]
      .find((anchor) => anchor.textContent?.includes('1.1. 子标题'))!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(parent.textContent).toContain('子标题正文')
    expect(view.state.selection.main.from).toBe(source.indexOf('### 1.1. 子标题'))
    view.destroy()
  })

  it('edits a TNotes component without leaving visual mode', () => {
    const source = '<B id="BV1QR4y1y7GG" />'
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), visualMarkdownExtensions(context, () => undefined)]
      })
    })
    const editor = parent.querySelector<HTMLElement>('.tn-visual-block-editor')!
    const toggle = editor.querySelector<HTMLButtonElement>('.tn-visual-block-toggle')!
    const textarea = editor.querySelector<HTMLTextAreaElement>('textarea')!

    toggle.click()
    textarea.value = '<B id="BV1NEW" />'
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }))
    ;[...editor.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '应用')!
      .click()

    expect(view.state.doc.toString()).toBe('<B id="BV1NEW" />')
    view.destroy()
  })

  it('renders TNotes swiper, code-group, mindmap and note-reference surfaces', () => {
    const swiper = collectVisualBlocks(
      '::: swiper\n\n![第一张](./assets/1.png)\n\n![第二张](./assets/2.png)\n\n:::'
    )[0]
    const codeGroup = collectVisualBlocks(
      '::: code-group\n\n```ts [TypeScript]\nconst value = 1\n```\n\n```js [JavaScript]\nconst value = 2\n```\n\n:::'
    )[0]
    const mindmap = collectVisualBlocks('```mindmap [项目]\n- Desk\n- Core\n```')[0]
    const references = collectVisualBlocks("<N :ids=\"['0001', '0002']\" />")[0]

    expect(renderVisualBlock(swiper, context)).toContain('tn-swiper')
    expect(renderVisualBlock(swiper, context)).toContain('tnotes-asset://asset?')
    expect(renderVisualBlock(codeGroup, context)).toContain('data-code-tab="0"')
    expect(renderVisualBlock(codeGroup, context)).toContain('TypeScript')
    expect(mindmap.kind).toBe('mindmap')
    expect(renderVisualBlock(mindmap, context)).toContain('正在加载脑图')
    expect(renderVisualBlock(references, context)).toContain('正在解析关联笔记')
  })

  it('renders the first-party B/E/F, Tooltip and explicit mindmap components', () => {
    const bilibili = collectVisualBlocks('<B id="BV1QR4y1y7GG" />')[0]
    const words = collectVisualBlocks("<EnWordList needSort :words=\"['zebra', 'apple']\" />")[0]
    const footprints = collectVisualBlocks(
      '<Footprints :times="[2025, 3, 15, 0, 43]">\n<template #text-area><p>正在整理笔记</p></template>\n<template #image-list><img src="./assets/1.png"></template>\n</Footprints>'
    )[0]
    const tooltip = collectVisualBlocks('这里有 <Tooltip text="补充说明">提示文字</Tooltip>。')[0]
    const explicitMindmap = collectVisualBlocks(
      '<MindmapPreview content="%23%20Root%0A%0A-%20Child" />'
    )[0]
    const legacyMarkmap = collectVisualBlocks('```markmap\n# Root\n\n- Child\n```')[0]
    const discussions = collectVisualBlocks('<Discussions />')[0]

    expect(renderVisualBlock(bilibili, context)).toContain('BV1QR4y1y7GG')
    expect(renderVisualBlock(words, context)).toMatch(/apple[\s\S]*zebra/)
    expect(renderVisualBlock(footprints, context)).toContain('2025-03-15 00:43')
    expect(renderVisualBlock(footprints, context)).toContain('tnotes-asset://asset?')
    expect(renderVisualBlock(tooltip, context)).toContain('data-tooltip="补充说明"')
    expect(renderVisualBlock(explicitMindmap, context)).toContain('data-mindmap-content')
    expect(legacyMarkmap.kind).toBe('mindmap')
    expect(renderVisualBlock(discussions, context)).toContain('站点布局组件')
  })

  it('collects and renders block and inline KaTeX without changing Markdown', () => {
    const source = '$$\nE = mc^2\n$$\n\n行内公式 $a^2+b^2=c^2$。'
    const blocks = collectVisualBlocks(source)

    expect(blocks[0]).toMatchObject({ kind: 'math', source: '$$\nE = mc^2\n$$' })
    expect(renderVisualBlock(blocks[0], context)).toContain('class="katex"')
    expect(renderVisualBlock(blocks[1], context)).toContain('tn-math-inline')
    expect(blocks.map((block) => block.source).join('\n\n')).toBe(source)
  })

  it('preserves KaTeX layout markup inside Markdown table cells', () => {
    const source = [
      '| equation | description |',
      '| --- | --- |',
      '| $x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$ | quadratic formula |'
    ].join('\n')
    const [table] = collectVisualBlocks(source)
    const html = renderVisualBlock(table, context)

    expect(table.kind).toBe('table')
    expect(html).toContain('<thead>')
    expect(html).toContain('tn-math-inline')
    expect(html).toContain('class="vlist-t"')
    expect(html).toMatch(/style="height:[^"]+"/)
  })

  it('opens and applies a block formula editor without leaving visual mode', () => {
    const source = '$$ x = 1 $$'
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [markdown(), visualMarkdownExtensions(context, () => undefined)]
      })
    })
    const preview = parent.querySelector<HTMLElement>('.tn-formula-preview')
    const panel = parent.querySelector<HTMLElement>('.tn-formula-panel')
    const textarea = parent.querySelector<HTMLTextAreaElement>('.tn-formula-source')

    expect(preview).toBeTruthy()
    expect(panel?.hidden).toBe(true)
    preview?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(panel?.hidden).toBe(false)
    expect(textarea?.value).toBe('x = 1')

    textarea!.value = 'x = 2'
    textarea?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
    )
    expect(view.state.doc.toString()).toBe('$$ x = 2 $$')
    view.destroy()
  })
})
