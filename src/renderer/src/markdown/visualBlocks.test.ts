// @vitest-environment happy-dom

import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { collectVisualBlocks, renderVisualBlock } from './visualBlocks'
import { visualMarkdownExtensions } from './visualExtension'

const context = { knowledgeBaseId: 'knowledge/base', noteUuid: 'note-1' }

describe('visual Markdown blocks', () => {
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
      '![示例](./assets/demo.png)\n\n<img src="javascript:alert(1)" onerror="alert(1)">'
    )
    const html = renderVisualBlock(block, context)

    expect(html).toContain('tnotes-asset://asset?')
    expect(html).toContain('knowledgeBaseId=knowledge%2Fbase')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
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
})
