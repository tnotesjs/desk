// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undoInputRule } from '@milkdown/kit/prose/inputrules'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

import { rawBlockProjectionPlugins } from '../editor/markdown/rawBlockProjection'
import {
  createBlockShortcutPlugin,
  createMarkdownShortcutInputRules,
  findEnterBlockShortcut
} from './markdownInputRules'

vi.hoisted(() => {
  Object.defineProperty(document, 'compatMode', { configurable: true, value: 'CSS1Compat' })
})

vi.mock('katex', () => ({
  default: {
    render: (value: string, dom: HTMLElement) => {
      dom.textContent = value
    },
    renderToString: (value: string) => value
  }
}))

const editors: Crepe[] = []

async function createEditor(
  onRawBlockInserted = vi.fn(),
  defaultValue = ''
): Promise<{
  crepe: Crepe
  view: EditorView
}> {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = new Crepe({ root, defaultValue })
  crepe.editor.use(rawBlockProjectionPlugins)
  crepe.editor.use(createMarkdownShortcutInputRules())
  crepe.editor.use(createBlockShortcutPlugin({ onRawBlockInserted }))
  await crepe.create()
  editors.push(crepe)
  return {
    crepe,
    view: crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  }
}

function typeText(view: EditorView, text: string): void {
  for (const character of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr.insertText(character, from, to))
    )
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to))
  }
}

function pressEnter(view: EditorView): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Enter' })
  return Boolean(view.someProp('handleKeyDown', (handler) => handler(view, event)))
}

function firstTextMarks(view: EditorView): string[] {
  return view.state.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name) ?? []
}

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

describe('0006 block shortcuts', () => {
  it.each([
    [':::tip', 'tip'],
    [':::info', 'info'],
    [':::warning', 'warning'],
    [':::error', 'danger'],
    [':::danger', 'danger'],
    [':::details', 'details'],
    [':::code-group', 'code-group'],
    [':::swiper', 'swiper'],
    [':::code', 'code'],
    ['```mermaid', 'mermaid'],
    ['```mmd', 'mermaid'],
    ['```mindmap', 'mindmap'],
    ['```mmp', 'mindmap']
  ])('maps the complete exact trigger %s to %s', (trigger, id) => {
    expect(findEnterBlockShortcut(trigger)?.id).toBe(id)
    expect(findEnterBlockShortcut(trigger.toUpperCase())?.id).toBe(id)
  })

  it('maps exact triggers case-insensitively without prefix collisions', () => {
    expect(findEnterBlockShortcut(':::TIP')?.id).toBe('tip')
    expect(findEnterBlockShortcut(':::error')?.id).toBe('danger')
    expect(findEnterBlockShortcut(':::code-group')?.id).toBe('code-group')
    expect(findEnterBlockShortcut(':::code-group extra')).toBeNull()
    expect(findEnterBlockShortcut('::: tip')).toBeNull()
    expect(findEnterBlockShortcut(':::')).toBeNull()
  })

  it('turns an exact top-level container trigger into the shared raw block', async () => {
    const opened = vi.fn()
    const { view } = await createEditor(opened)
    typeText(view, ':::TIP')

    expect(pressEnter(view)).toBe(true)
    expect(view.state.doc.firstChild?.type.name).toBe('deskRawBlock')
    expect(view.state.doc.firstChild?.attrs.kind).toBe('raw-container')
    expect(view.state.doc.firstChild?.attrs.source).toBe('::: tip 💡 TIP\n\n:::\n')
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(opened).toHaveBeenCalledWith(0)
  })

  it('turns :::code into an empty JavaScript code block', async () => {
    const { view } = await createEditor()
    typeText(view, ':::code')
    expect(pressEnter(view)).toBe(true)
    expect(view.state.doc.firstChild?.type.name).toBe('code_block')
    expect(view.state.doc.firstChild?.attrs.language).toBe('js')
    expect(view.state.doc.firstChild?.textContent).toBe('')
  })

  it('turns diagram aliases into raw diagrams on space', async () => {
    const { view } = await createEditor()
    typeText(view, '```mmd ')
    expect(view.state.doc.firstChild?.type.name).toBe('deskRawBlock')
    expect(view.state.doc.firstChild?.attrs.kind).toBe('raw-diagram')
    expect(view.state.doc.firstChild?.attrs.source).toBe('```mermaid\n\n```\n')
  })

  it('turns diagram aliases into raw diagrams on Enter too', async () => {
    const opened = vi.fn()
    const { view } = await createEditor(opened)
    typeText(view, '```MMP')
    expect(pressEnter(view)).toBe(true)
    expect(view.state.doc.firstChild?.type.name).toBe('deskRawBlock')
    expect(view.state.doc.firstChild?.attrs.kind).toBe('raw-diagram')
    expect(view.state.doc.firstChild?.attrs.source).toBe('```mindmap\n\n```\n')
  })

  it('does not transform leading-space or list-item triggers', async () => {
    const { view } = await createEditor()
    typeText(view, ' :::tip')
    pressEnter(view)
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')

    const listEditor = await createEditor(vi.fn(), '- :::tip')
    const end = listEditor.view.state.doc.content.size - 1
    listEditor.view.dispatch(
      listEditor.view.state.tr.setSelection(
        TextSelection.create(listEditor.view.state.doc, end, end)
      )
    )
    pressEnter(listEditor.view)
    expect(listEditor.view.state.doc.firstChild?.type.name).toBe('bullet_list')
    expect(listEditor.view.state.doc.textContent).toContain(':::tip')
  })
})

describe('0007 space-triggered inline rules', () => {
  it.each([
    ['*斜体*', 'emphasis'],
    ['_斜体_', 'emphasis'],
    ['**粗体**', 'strong'],
    ['__粗体__', 'strong'],
    ['~~删除~~', 'strike_through'],
    ['`代码`', 'inlineCode']
  ])(
    'keeps %s literal until Space, then applies %s without inserting Space',
    async (source, mark) => {
      const { view } = await createEditor()
      typeText(view, source)
      expect(view.state.doc.textContent).toBe(source)
      expect(firstTextMarks(view)).not.toContain(mark)

      typeText(view, ' ')
      expect(view.state.doc.textContent).toBe(
        source.replace(/^\*\*|\*\*$|^__|__$|^~~|~~$|^\*|\*$|^_|_$|^`|`$/g, '')
      )
      expect(firstTextMarks(view)).toContain(mark)
      expect(undoInputRule(view.state, view.dispatch)).toBe(false)
    }
  )

  it('creates inline math only after Space and consumes that Space', async () => {
    const { view } = await createEditor()
    typeText(view, '$a^2$')
    expect(view.state.doc.textContent).toBe('$a^2$')

    typeText(view, ' ')
    const math = view.state.doc.firstChild?.firstChild
    expect(math?.type.name).toBe('math_inline')
    expect(math?.attrs.value).toBe('a^2')
    expect(view.state.doc.textContent).toBe('')
    expect(undoInputRule(view.state, view.dispatch)).toBe(false)
  })

  it('keeps closed delimiters literal when Enter is pressed instead of Space', async () => {
    const { view } = await createEditor()
    typeText(view, '**literal**')
    // Crepe handles Enter by splitting the paragraph; the inline rule must not
    // treat that Enter as the Space trigger.
    expect(pressEnter(view)).toBe(true)
    expect(view.state.doc.textContent).toBe('**literal**')
    expect(firstTextMarks(view)).not.toContain('strong')
  })

  it('Backspace deletes converted content instead of restoring delimiters', async () => {
    const { view } = await createEditor()
    typeText(view, '*abc* ')
    const cursor = view.state.selection.from
    view.dispatch(view.state.tr.delete(cursor - 1, cursor))
    expect(view.state.doc.textContent).toBe('ab')
    expect(firstTextMarks(view)).toContain('emphasis')
    expect(view.state.doc.textContent).not.toContain('*')
  })
})
