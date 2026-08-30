// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorStateCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'

import {
  projectRawBlocksForMilkdown,
  rawBlockProjectionPlugins
} from '../editor/markdown/rawBlockProjection'
import {
  adjacentRawBlockSelectionPosition,
  createRawBlockSelectionPlugin
} from './rawBlockInteractions'

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

async function createEditor(
  source = '上方段落\n\n<B id="selection" />\n\n下方段落\n'
): Promise<Editor> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, projectRawBlocksForMilkdown(source))
    })
    .use(commonmark)
    .use(gfm)
    .use(rawBlockProjectionPlugins)
    .use(createRawBlockSelectionPlugin())
  editors.push(editor)
  await editor.create()
  return editor
}

function positions(editor: Editor): { beforeEnd: number; raw: number; afterStart: number } {
  const result = { beforeEnd: -1, raw: -1, afterStart: -1 }
  editor.action((ctx) => {
    const state = ctx.get(editorStateCtx)
    let textIndex = 0
    state.doc.descendants((node, position) => {
      if (node.type.name === 'deskRawBlock') result.raw = position
      if (node.type.name === 'paragraph') {
        if (textIndex === 0) result.beforeEnd = position + 1 + node.content.size
        else result.afterStart = position + 1
        textIndex += 1
      }
    })
  })
  return result
}

describe('raw block keyboard selection', () => {
  it('enters the before boundary and Delete removes the complete atom', async () => {
    const editor = await createEditor()
    const pos = positions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.beforeEnd)))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect(view.dom.querySelector('.desk-raw-boundary-cursor')?.getAttribute('data-side')).toBe(
        'before'
      )
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
      expect(view.state.doc.toString()).not.toContain('deskRawBlock')
    })
  })

  it('enters the after boundary and Backspace removes the complete atom', async () => {
    const editor = await createEditor()
    const pos = positions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.afterStart))
      )
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect(view.dom.querySelector('.desk-raw-boundary-cursor')?.getAttribute('data-side')).toBe(
        'after'
      )
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      expect(view.state.doc.toString()).not.toContain('deskRawBlock')
    })
  })

  it('deletes only the selected line among consecutive standalone breaks', async () => {
    const editor = await createEditor('上方段落\n\n<br>\n\n<br/>\n\n<br />\n\n下方段落\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const breaks: Array<{ position: number; source: string }> = []
      view.state.doc.descendants((node, position) => {
        if (node.type.name === 'deskRawBlock' && node.attrs.kind === 'raw-break') {
          breaks.push({ position, source: node.attrs.source })
        }
      })
      expect(breaks.map(({ source }) => source)).toEqual(['<br>', '<br/>', '<br />'])
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, breaks[1].position))
      )
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))

      const remaining: string[] = []
      view.state.doc.descendants((node) => {
        if (node.type.name === 'deskRawBlock' && node.attrs.kind === 'raw-break') {
          remaining.push(node.attrs.source)
        }
      })
      expect(remaining).toEqual(['<br>', '<br />'])
    })
  })

  it('owns exactly one state-derived caret while moving between standalone breaks', async () => {
    const editor = await createEditor('上方段落\n\n<br />\n\n<br />\n\n<br />\n\n下方段落\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const positions: number[] = []
      view.state.doc.descendants((node, position) => {
        if (node.type.name === 'deskRawBlock' && node.attrs.kind === 'raw-break') {
          positions.push(position)
        }
      })

      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, positions[0])))
      expect(view.dom.querySelectorAll('.desk-raw-selection-cursor')).toHaveLength(1)

      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, positions[2])))
      expect(view.dom.querySelectorAll('.desk-raw-selection-cursor')).toHaveLength(1)
      expect(view.dom.querySelector('.desk-raw-boundary-cursor')).toBeNull()
    })
  })

  it('marks empty lines in a range without relying on a full-width native surface', async () => {
    const editor = await createEditor('上方段落\n\n<B id="selection" />\n\n<br />\n\n下方段落\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)
        )
      )

      expect(
        view.dom
          .querySelector('[data-kind="raw-component"]')
          ?.classList.contains('desk-raw-block--range-selected')
      ).toBe(true)
      expect(
        view.dom
          .querySelector('[data-kind="raw-break"]')
          ?.classList.contains('desk-raw-block--range-selected')
      ).toBe(true)
    })
  })

  it('marks every consecutive empty line crossed by a text range', async () => {
    const editor = await createEditor('上方段落\n\n<br />\n\n<br />\n\n<br />\n\n下方段落\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)
        )
      )

      expect(
        view.dom.querySelectorAll('[data-kind="raw-break"].desk-raw-block--range-selected')
      ).toHaveLength(3)
    })
  })

  it('selects the whole atom with Shift+ArrowDown from the previous paragraph end', async () => {
    const editor = await createEditor()
    const pos = positions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.beforeEnd)))
      expect(adjacentRawBlockSelectionPosition(view.state, 'down')).toBe(pos.raw)
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
      )
    })
    editor.action((ctx) => {
      const selection = ctx.get(editorStateCtx).selection
      expect(selection).toBeInstanceOf(NodeSelection)
      expect((selection as NodeSelection).node.type.name).toBe('deskRawBlock')
    })
  })

  it('selects the whole atom with Shift+ArrowUp from the next paragraph start', async () => {
    const editor = await createEditor()
    const pos = positions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.afterStart))
      )
      expect(adjacentRawBlockSelectionPosition(view.state, 'up')).toBe(pos.raw)
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })
      )
    })
    editor.action((ctx) => {
      const selection = ctx.get(editorStateCtx).selection
      expect(selection).toBeInstanceOf(NodeSelection)
      expect(selection.from).toBe(pos.raw)
    })
  })

  it('does not hijack a caret that is not at a block boundary', async () => {
    const editor = await createEditor()
    const pos = positions(editor)
    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const middle = pos.beforeEnd - 1
      const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, middle)))
      expect(adjacentRawBlockSelectionPosition(next, 'down')).toBeNull()
    })
  })
})
