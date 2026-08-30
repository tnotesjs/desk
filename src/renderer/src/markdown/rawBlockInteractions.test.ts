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
  codeBlockWholeSelectPosition,
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

function codePositions(editor: Editor): {
  beforeEnd: number
  code: number
  afterStart: number
} {
  const result = { beforeEnd: -1, code: -1, afterStart: -1 }
  editor.action((ctx) => {
    const state = ctx.get(editorStateCtx)
    let textIndex = 0
    state.doc.descendants((node, position) => {
      if (node.type.name === 'code_block') result.code = position
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
  it('ArrowDown selects the whole atom; Delete removes it', async () => {
    const editor = await createEditor()
    const pos = positions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.beforeEnd)))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(pos.raw)
      expect(view.dom.querySelector('.desk-raw-boundary-cursor')).toBeNull()
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
      expect(view.state.doc.toString()).not.toContain('deskRawBlock')
    })
  })

  it('ArrowUp selects the whole atom; Backspace removes it', async () => {
    const editor = await createEditor()
    const pos = positions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.afterStart))
      )
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(pos.raw)
      expect(view.dom.querySelector('.desk-raw-boundary-cursor')).toBeNull()
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      expect(view.state.doc.toString()).not.toContain('deskRawBlock')
    })
  })

  it('selected atom: Backspace and Delete both remove it; ArrowDown exits past it', async () => {
    const editor = await createEditor()
    const pos = positions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.beforeEnd)))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      expect(view.state.doc.toString()).not.toContain('deskRawBlock')
    })

    const editor2 = await createEditor()
    const pos2 = positions(editor2)
    editor2.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos2.beforeEnd)))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(TextSelection)
      expect(view.state.selection.head).toBe(pos2.afterStart)
      expect(view.state.doc.toString()).toContain('deskRawBlock')
    })
  })

  it('marks visible raw atoms crossed by a text range', async () => {
    const editor = await createEditor('上方段落\n\n<B id="selection" />\n\n下方段落\n')
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
    })
  })

  it('marks the whole atom with Shift+ArrowDown while retaining the text anchor', async () => {
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
      expect(selection).toBeInstanceOf(TextSelection)
      expect(selection.head).toBe(pos.beforeEnd)
      expect(
        ctx.get(editorViewCtx).dom.querySelectorAll('.desk-raw-block--range-selected')
      ).toHaveLength(1)
    })
  })

  it('marks the whole atom with Shift+ArrowUp while retaining the text anchor', async () => {
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
      expect(selection).toBeInstanceOf(TextSelection)
      expect(selection.head).toBe(pos.afterStart)
      expect(
        ctx.get(editorViewCtx).dom.querySelectorAll('.desk-raw-block--range-selected')
      ).toHaveLength(1)
    })
  })

  it('does not hijack ArrowDown from a non-last visual line', async () => {
    const editor = await createEditor('第一行\n第二行还在段内\n\n<B id="selection" />\n\n下方段落\n')
    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      // Caret after first character of a multi-line paragraph (still on first line).
      const next = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))
      expect(adjacentRawBlockSelectionPosition(next, 'down')).toBeNull()
    })
  })

  it('maps standalone breaks to empty paragraphs instead of desk raw atoms', async () => {
    const editor = await createEditor('上方段落\n\n<br />\n\n下方段落\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let deskRawBlocks = 0
      let emptyParagraphs = 0
      view.state.doc.descendants((node) => {
        if (node.type.name === 'deskRawBlock') deskRawBlocks += 1
        if (node.type.name === 'paragraph' && node.content.size === 0) {
          emptyParagraphs += 1
        }
      })
      expect(deskRawBlocks).toBe(0)
      expect(emptyParagraphs).toBeGreaterThanOrEqual(1)
      expect(view.dom.querySelector('[data-type="desk-raw-block"]')).toBeNull()
    })
  })
})

describe('code_block keyboard selection', () => {
  it('ArrowDown whole-selects the code block with NodeSelection; ArrowDown again exits', async () => {
    const editor = await createEditor('上方段落\n\n```js\nconst x = 1\n```\n\n下方段落\n')
    const pos = codePositions(editor)
    expect(pos.code).toBeGreaterThan(-1)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.beforeEnd)))
      expect(adjacentRawBlockSelectionPosition(view.state, 'down')).toBe(pos.code)
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(pos.code)
      expect(codeBlockWholeSelectPosition(view.state)).toBe(pos.code)
      expect(view.dom.querySelector('.desk-code-block--whole-selected')).toBeTruthy()
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(TextSelection)
      expect(view.state.selection.head).toBe(pos.afterStart)
      expect(codeBlockWholeSelectPosition(view.state)).toBeNull()
      expect(view.state.doc.toString()).toContain('code_block')
    })
  })

  it('ArrowDown from mid-line on the last visual line whole-selects the code block', async () => {
    const editor = await createEditor('上方段落\n\n```js\nconst x = 1\n```\n\n下方段落\n')
    const pos = codePositions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      // Not at absolute end — one character before the end of the single-line paragraph.
      const midLastLine = pos.beforeEnd - 1
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, midLastLine)))
      expect(adjacentRawBlockSelectionPosition(view.state, 'down')).toBe(pos.code)
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(pos.code)
      expect(codeBlockWholeSelectPosition(view.state)).toBe(pos.code)
      expect(view.state.doc.toString()).toContain('code_block')
    })
  })

  it('does not skip an empty paragraph between text and the next code block', async () => {
    // Desk preserves blank lines as standalone <br /> → empty paragraphs.
    const editor = await createEditor('哈哈哈\n\n<br />\n\n```js\nconsole.log(123)\n```\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const state = view.state
      let textEnd = -1
      let emptyPos = -1
      let codePos = -1
      state.doc.descendants((node, position) => {
        if (node.type.name === 'code_block' && codePos < 0) codePos = position
        if (node.type.name === 'paragraph') {
          if (node.textContent === '哈哈哈') textEnd = position + 1 + node.content.size
          else if (node.content.size === 0 && emptyPos < 0) emptyPos = position
        }
      })
      expect(textEnd).toBeGreaterThan(-1)
      expect(emptyPos).toBeGreaterThan(-1)
      expect(codePos).toBeGreaterThan(-1)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, textEnd)))
      // Immediate neighbor is the blank line — leave ArrowDown to ProseMirror.
      expect(adjacentRawBlockSelectionPosition(view.state, 'down')).toBeNull()
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, emptyPos + 1))
      )
      expect(adjacentRawBlockSelectionPosition(view.state, 'down')).toBe(codePos)
    })
  })

  it('whole-selected code block: Delete and Backspace both remove it', async () => {
    const editor = await createEditor('上方段落\n\n```js\nconst x = 1\n```\n\n下方段落\n')
    const pos = codePositions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.beforeEnd)))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(codeBlockWholeSelectPosition(view.state)).toBe(pos.code)
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
      expect(view.state.doc.toString()).not.toContain('code_block')
    })

    const editor2 = await createEditor('上方段落\n\n```js\nconst x = 1\n```\n\n下方段落\n')
    const pos2 = codePositions(editor2)
    editor2.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos2.afterStart)))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      expect(codeBlockWholeSelectPosition(view.state)).toBe(pos2.code)
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      expect(view.state.doc.toString()).not.toContain('code_block')
    })
  })

  it('ArrowDown from a whole-selected code chains into the next adjacent code', async () => {
    const editor = await createEditor(
      '上方\n\n```js\none\n```\n\n```ts\ntwo\n```\n\n下方\n'
    )
    const codes: number[] = []
    editor.action((ctx) => {
      ctx.get(editorStateCtx).doc.descendants((node, position) => {
        if (node.type.name === 'code_block') codes.push(position)
      })
    })
    expect(codes.length).toBe(2)
    let beforeEnd = -1
    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      state.doc.descendants((node, position) => {
        if (node.type.name === 'paragraph' && beforeEnd < 0) {
          beforeEnd = position + 1 + node.content.size
        }
      })
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, beforeEnd)))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(codes[0])
      expect(codeBlockWholeSelectPosition(view.state)).toBe(codes[0])
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(codes[1])
      expect(codeBlockWholeSelectPosition(view.state)).toBe(codes[1])
      expect(view.state.doc.toString()).toContain('code_block')
    })
  })

  it('ArrowUp whole-selects the code block and leaves the caret off the following line', async () => {
    const editor = await createEditor('上方段落\n\n```js\nconst x = 1\n```\n\n下方段落\n')
    const pos = codePositions(editor)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.afterStart)))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(pos.code)
      expect(view.state.selection.head).not.toBe(pos.afterStart)
      expect(codeBlockWholeSelectPosition(view.state)).toBe(pos.code)
    })
  })
})
