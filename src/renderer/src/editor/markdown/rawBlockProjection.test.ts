// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorStateCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown, replaceAll } from '@milkdown/kit/utils'

import {
  createProjectedRawBlockMarker,
  projectRawBlocksForMilkdown,
  rawBlockProjectionPlugins,
  readProjectedRawBlockMarker,
  type ProjectedRawBlock
} from './rawBlockProjection'
import { reconcileMarkdownSource } from './sourcePreservation'

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

async function createEditor(source: string): Promise<Editor> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, projectRawBlocksForMilkdown(source))
    })
    .use(commonmark)
    .use(gfm)
    // Crepe also installs product plugins after CommonMark/GFM.
    .use(rawBlockProjectionPlugins)
  editors.push(editor)
  await editor.create()
  return editor
}

describe('Milkdown raw block projection', () => {
  it('round-trips Unicode and original line endings through an opaque marker', () => {
    const block: ProjectedRawBlock = {
      kind: 'raw-component',
      source: '<中文组件 :标题="你好 👋">\r\n内容\r\n</中文组件>',
      hidden: false
    }

    expect(readProjectedRawBlockMarker(createProjectedRawBlockMarker(block))).toEqual(block)
    expect(readProjectedRawBlockMarker('<!--desk-raw-block:v0:html:0:eA==-->')).toBeNull()
  })

  it('projects TNotes and HTML blocks but leaves fenced code available to CommonMark', () => {
    const source = [
      '---',
      'title: 测试',
      '---',
      '',
      ':::: code-group',
      '```ts [TypeScript]',
      'const value = 1',
      '```',
      '::::',
      '',
      '<<< ./shared.md',
      '',
      '<EnWordList :words="[\'one\']" />',
      '',
      '<div class="note">',
      'raw html',
      '</div>',
      '',
      '```ts',
      'const editable = true',
      '```',
      ''
    ].join('\r\n')
    const projected = projectRawBlocksForMilkdown(source)
    const markers = projected.match(/<!--desk-raw-block:v1:[^\n]+-->/g) ?? []

    expect(markers).toHaveLength(5)
    expect(markers.map((marker) => readProjectedRawBlockMarker(marker)?.kind)).toEqual([
      'raw-frontmatter',
      'raw-container',
      'raw-include',
      'raw-component',
      'html'
    ])
    expect(projected).toContain('```ts\r\nconst editable = true\r\n```')
    expect(projected).not.toContain('const value = 1')
  })

  it('projects a generated title and complete TOC region as single immutable atoms', async () => {
    const source = [
      '# 0001. 标题  ',
      '',
      '<!-- region:toc -->',
      '- [1. 第一节](#1-第一节)',
      '  - [1.1. 子标题](#11-子标题)',
      '<!-- endregion:toc -->',
      '',
      '正文',
      ''
    ].join('\r\n')
    const projected = projectRawBlocksForMilkdown(source)
    const blocks = (projected.match(/<!--desk-raw-block:v1:[^\n]+-->/g) ?? [])
      .map(readProjectedRawBlockMarker)
      .filter((block): block is ProjectedRawBlock => Boolean(block))

    expect(blocks).toEqual([
      { kind: 'raw-generated-title', source: '# 0001. 标题  ', hidden: false },
      {
        kind: 'raw-generated-toc',
        source: [
          '<!-- region:toc -->',
          '- [1. 第一节](#1-第一节)',
          '  - [1.1. 子标题](#11-子标题)',
          '<!-- endregion:toc -->'
        ].join('\r\n'),
        hidden: false
      }
    ])
    expect(projected).not.toContain('- [1. 第一节](#1-第一节)')

    const editor = await createEditor(source)
    const baseline = editor.action(getMarkdown())
    expect(reconcileMarkdownSource(source, baseline, baseline)).toBe(source)

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const generatedPositions: Array<{ position: number; size: number }> = []
      view.state.doc.descendants((node, position) => {
        if (!['raw-generated-title', 'raw-generated-toc'].includes(node.attrs.kind)) return
        generatedPositions.push({ position, size: node.nodeSize })
      })
      const title = generatedPositions[0]
      const toc = generatedPositions[1]
      view.dispatch(view.state.tr.delete(title.position, title.position + title.size))
      view.dispatch(view.state.tr.delete(toc.position, toc.position + toc.size))
      view.dispatch(view.state.tr.setNodeAttribute(title.position, 'source', '# changed'))
      view.dispatch(view.state.tr.setNodeAttribute(toc.position, 'source', 'changed'))
    })

    expect(editor.action(getMarkdown())).toBe(baseline)
  })

  it('renders a standalone HTML break as an empty visual line while preserving its source', async () => {
    const source = '## 2. 评价\n\n<br />\n\n正文\n'
    const projected = projectRawBlocksForMilkdown(source)
    const marker = projected.match(/<!--desk-raw-block:v1:[^\n]+-->/)?.[0]

    expect(readProjectedRawBlockMarker(marker ?? '')).toEqual({
      kind: 'raw-break',
      source: '<br />',
      hidden: false
    })

    const editor = await createEditor(source)
    const emptyLine = document.querySelector<HTMLElement>('.desk-raw-block--empty-line')
    expect(emptyLine).not.toBeNull()
    expect(emptyLine?.textContent).toBe('')
    expect(emptyLine?.querySelector('.desk-raw-block__label')).toBeNull()

    const baseline = editor.action(getMarkdown())
    expect(reconcileMarkdownSource(source, baseline, baseline)).toBe(source)
  })

  it('keeps an explicit deletion among consecutive standalone breaks', async () => {
    const source = 'before\n\n<br />\n\n<br />\n\n<br />\n\nafter\n'
    const editor = await createEditor(source)
    const baseline = editor.action(getMarkdown())

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const breaks: Array<{ position: number; size: number }> = []
      view.state.doc.descendants((node, position) => {
        if (node.type.name === 'deskRawBlock' && node.attrs.kind === 'raw-break') {
          breaks.push({ position, size: node.nodeSize })
        }
      })
      const middle = breaks[1]
      view.dispatch(view.state.tr.delete(middle.position, middle.position + middle.size))
    })

    const current = editor.action(getMarkdown())
    const reconciled = reconcileMarkdownSource(source, baseline, current)
    expect(current.match(/<br \/>/g)).toHaveLength(2)
    expect(reconciled.match(/<br \/>/g)).toHaveLength(2)
  })

  it('keeps a break deletion when surrounding paragraphs also changed', async () => {
    const fill = Array.from({ length: 28 }, (_, index) => `填充段落 ${index + 1}`).join('\n\n')
    const source = `# Block interactions\n\n顶部段落\n\n组件上方\n\n<B id="selection-e2e" />\n\n组件下方\n\n${fill}\n\n底部段落\n\n<br />\n\n<br />\n\n<br />\n`
    const baselineEditor = await createEditor(source)
    const baseline = baselineEditor.action(getMarkdown())
    const edited = `# Block interactions\n\n/\n\n组件上方\n\n<B id="selection-e2e" />\n\n组件下方\n\n${fill}\n\n底部段落\n\n<br />\n\n<br />\n\n/\n`
    const currentEditor = await createEditor(edited)
    const current = currentEditor.action(getMarkdown())
    const reconciled = reconcileMarkdownSource(source, baseline, current)

    expect(current.match(/<br \/>/g)).toHaveLength(2)
    expect(reconciled.match(/<br \/>/g)).toHaveLength(2)
  })

  it('renders a collapsible toggle for the generated TOC', async () => {
    const source = [
      '# 0001. 标题',
      '',
      '<!-- region:toc -->',
      '- [1. 第一节](#1-第一节)',
      '<!-- endregion:toc -->',
      '',
      '正文',
      ''
    ].join('\n')
    await createEditor(source)
    const toc = document.querySelector<HTMLElement>('.desk-generated-toc')
    expect(toc).not.toBeNull()

    const toggle = toc?.querySelector<HTMLButtonElement>('.desk-generated-toc__toggle')
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(toc?.querySelector('.desk-generated-toc__list')).not.toBeNull()

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(toc?.classList.contains('is-collapsed')).toBe(true)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    // The list is hidden by the `.is-collapsed .desk-generated-toc__list` rule.
    expect(toc?.classList.contains('is-collapsed')).toBe(true)
    expect(toggle?.getAttribute('aria-label')).toBe('展开目录')
  })

  it('keeps reference definitions available for resolution and adds one restoration atom', () => {
    const definitions = [
      '[guide]: <https://example.com/docs> "Docs title"',
      '[asset]: ./images/logo.png',
      "  'Logo title'"
    ].join('\n')
    const projected = projectRawBlocksForMilkdown(`See [guide].\n\n${definitions}\n`)
    const marker = projected.match(/<!--desk-raw-block:v1:[^\n]+-->/)?.[0]

    expect(projected).toContain(definitions)
    expect(marker).toBeDefined()
    expect(readProjectedRawBlockMarker(marker ?? '')).toEqual({
      kind: 'raw-reference-definition',
      source: definitions,
      hidden: true
    })
  })

  it('projects a table containing inline HTML but keeps a plain table editable', () => {
    const htmlTable = ['| Name | Value |', '| --- | --- |', '| first<br>second | 1 |'].join('\n')
    const plainTable = ['| Name | Value |', '| --- | --- |', '| first | 1 |'].join('\n')
    const projectedHtml = projectRawBlocksForMilkdown(htmlTable)

    expect(readProjectedRawBlockMarker(projectedHtml)).toEqual({
      kind: 'table',
      source: htmlTable,
      hidden: false
    })
    expect(projectRawBlocksForMilkdown(plainTable)).toBe(plainTable)
  })

  it('parses projected constructs into block atoms and serializes their exact source', async () => {
    const rawBlocks: ProjectedRawBlock[] = [
      { kind: 'raw-frontmatter', source: '---\ntitle: "A"  \n---', hidden: false },
      {
        kind: 'raw-container',
        source: ':::: details\ncontent with  spaces  \n::::',
        hidden: false
      },
      { kind: 'raw-include', source: '<<< ./shared.md [Shared]', hidden: false },
      { kind: 'raw-component', source: '<Demo value="中文" />', hidden: false },
      { kind: 'html', source: '<!-- ordinary comment -->', hidden: false },
      { kind: 'html', source: '<aside data-x="1">raw</aside>', hidden: false },
      {
        kind: 'table',
        source: '| A | B |\n| --- | --- |\n| first<br>second | value |',
        hidden: false
      }
    ]
    const source = [
      rawBlocks[0].source,
      '# Heading',
      ...rawBlocks.slice(1).map((block) => block.source),
      '```ts\nx = 1\n```'
    ].join('\n\n')
    const editor = await createEditor(source)
    const atoms: Array<Record<string, unknown>> = []

    editor.action((ctx) => {
      ctx.get(editorStateCtx).doc.descendants((node) => {
        if (node.type.name === 'deskRawBlock') atoms.push(node.attrs)
      })
    })

    expect(atoms).toHaveLength(rawBlocks.length)
    expect(
      atoms.map(({ kind, source: rawSource, hidden }) => ({
        kind,
        source: rawSource,
        hidden
      }))
    ).toEqual(rawBlocks)

    const markdown = editor.action(getMarkdown())
    rawBlocks.forEach((block) => expect(markdown).toContain(block.source))
    expect(markdown).toContain('```ts\nx = 1\n```')
    expect(document.querySelectorAll('.desk-raw-block')).toHaveLength(rawBlocks.length)
    expect(document.querySelectorAll('.desk-raw-block--hidden')).toHaveLength(0)
  })

  it('rejects visual transactions that delete or mutate an opaque raw block', async () => {
    const source = 'before\n\n<<< ./shared.md\n\nafter\n'
    const editor = await createEditor(source)

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let rawPosition = -1
      let rawSize = 0
      view.state.doc.descendants((node, position) => {
        if (node.type.name !== 'deskRawBlock') return
        rawPosition = position
        rawSize = node.nodeSize
      })
      view.dispatch(view.state.tr.delete(rawPosition, rawPosition + rawSize))
    })

    expect(editor.action(getMarkdown())).toContain('<<< ./shared.md')
  })

  it('preserves real reference syntax and definitions when another block is edited', async () => {
    const original = [
      '#  References',
      '',
      'Read [the guide][guide] and view ![the logo][asset].',
      '',
      'Paragraph before edit.  ',
      '',
      '[guide]: <https://example.com/docs> "Docs title"',
      '[asset]: ./images/logo.png',
      "  'Logo title'",
      ''
    ].join('\r\n')
    const editor = await createEditor(original)
    const baseline = editor.action(getMarkdown())
    const editedInput = original.replace('Paragraph before edit.  ', 'Paragraph after edit.')

    editor.action(replaceAll(projectRawBlocksForMilkdown(editedInput), true))
    const current = editor.action(getMarkdown())
    const reconciled = reconcileMarkdownSource(original, baseline, current)

    expect(baseline).toContain('[the guide](https://example.com/docs "Docs title")')
    expect(baseline).toContain('![the logo](./images/logo.png "Logo title")')
    expect(reconciled).toBe(editedInput)
  })
})
