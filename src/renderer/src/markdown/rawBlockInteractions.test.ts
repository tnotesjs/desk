// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorStateCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { NodeSelection, Selection, TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import { BlockRangeSelection, verticalBlockSelectionKey } from './verticalBlockSelection'
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

const tableMarkdown = '| Header A | Header B |\n| --- | --- |\n| Cell A | Cell B |'

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
  it.each(['ArrowLeft', 'ArrowRight'])(
    '%s stays within a heading between a generated TOC and a raw block',
    async (key) => {
      const editor = await createEditor(
        '# 标题\n\n<!-- region:toc -->\n- [1. 概述](#1-概述)\n<!-- endregion:toc -->\n\n## 1. 概述\n\n<B id="selection" />\n'
      )
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        let headingStart = -1
        let headingLength = 0
        view.state.doc.descendants((node, position) => {
          if (node.type.name === 'heading') {
            headingStart = position + 1
            headingLength = node.content.size
          }
        })
        const offsets =
          key === 'ArrowLeft'
            ? Array.from({ length: headingLength }, (_, index) => index + 1)
            : Array.from({ length: headingLength }, (_, index) => index)
        for (const offset of offsets) {
          const position = headingStart + offset
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)))
          view.dom.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
          )
          // happy-dom does not execute browser caret movement. Desk must leave
          // the text caret alone here instead of replacing it with NodeSelection.
          expect(view.state.selection).toBeInstanceOf(TextSelection)
          expect(view.state.selection.head).toBe(position)
        }
      })
    }
  )

  it.each([
    ['raw', '<B id="selection" />'],
    ['code', '```js\nconst value = 1\n```']
  ])('only crosses horizontal text boundaries next to a %s block', async (_kind, block) => {
    const editor = await createEditor(`上方段落\n\n${block}\n\n下方段落\n`)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const first = view.state.doc.firstChild!
      const blockPosition = first.nodeSize
      const blockNode = view.state.doc.child(1)
      const afterStart = blockPosition + blockNode.nodeSize + 1
      for (const [key, caret, expected] of [
        ['ArrowRight', first.content.size, null],
        ['ArrowRight', first.content.size + 1, blockPosition],
        ['ArrowLeft', afterStart + 1, null],
        ['ArrowLeft', afterStart, blockPosition]
      ] as const) {
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)))
        const direction = key === 'ArrowLeft' ? 'left' : 'right'
        expect(adjacentRawBlockSelectionPosition(view.state, direction)).toBe(expected)
        // Exercise the fallback without a DOM event / capture listener.
        const event = new KeyboardEvent('keydown', { key, cancelable: true })
        view.someProp('handleKeyDown', (handle) => handle(view, event))
        if (expected === null) {
          expect(view.state.selection).toBeInstanceOf(TextSelection)
          expect(view.state.selection.head).toBe(caret)
        } else {
          expect(view.state.selection).toBeInstanceOf(NodeSelection)
          expect(view.state.selection.from).toBe(blockPosition)
        }
      }
    })
  })

  it('keeps horizontal movement between list items inside the list', async () => {
    const editor = await createEditor('<B />\n\n- 第一项\n- 第二项\n\n<B />\n')
    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const paragraphs: Array<{ start: number; end: number }> = []
      state.doc.descendants((node, position) => {
        if (node.type.name === 'paragraph') {
          paragraphs.push({ start: position + 1, end: position + 1 + node.content.size })
        }
      })
      const firstEnd = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, paragraphs[0].end))
      )
      const secondStart = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, paragraphs[1].start))
      )
      expect(adjacentRawBlockSelectionPosition(firstEnd, 'right')).toBeNull()
      expect(adjacentRawBlockSelectionPosition(secondStart, 'left')).toBeNull()
    })
  })

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
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos2.beforeEnd))
      )
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(TextSelection)
      expect(view.state.selection.head).toBe(pos2.afterStart)
      expect(view.state.doc.toString()).toContain('deskRawBlock')
    })
  })

  it('ArrowDown from a selected info atom lands on the following blank before text', async () => {
    const editor = await createEditor(
      [
        '## 2. 评价',
        '',
        '<br />',
        '',
        '::: info INFO',
        '',
        '这是输入的内容',
        '',
        ':::',
        '',
        '<br />',
        '',
        '上面这是空行',
        '',
        '```js',
        'console.log(123)',
        '```',
        ''
      ].join('\n')
    )
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let infoPos = -1
      let emptyBefore = -1
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'deskRawBlock' && node.attrs.hidden !== true && infoPos < 0) {
          infoPos = pos
        }
        if (node.type.name === 'paragraph' && node.content.size === 0 && infoPos < 0) {
          emptyBefore = pos + 1
        }
      })
      expect(infoPos).toBeGreaterThan(-1)
      expect(emptyBefore).toBeGreaterThan(-1)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, emptyBefore)))
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(infoPos)
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(TextSelection)
      expect(view.state.selection.from).toBeGreaterThan(infoPos)
      expect((view.state.selection as TextSelection).$head.parent.content.size).toBe(0)
      // Must not jump onto the code fence past the blank + following text.
      expect(codeBlockWholeSelectPosition(view.state)).toBeNull()
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
      expect(selection).toBeInstanceOf(BlockRangeSelection)
      expect(selection.anchor).toBe(pos.beforeEnd)
      expect(selection.head).toBeGreaterThan(pos.raw)
      expect(selection.empty).toBe(false)
      expect(
        ctx.get(editorViewCtx).dom.querySelectorAll('.desk-raw-block--range-selected')
      ).toHaveLength(1)
    })
  })

  it('Shift+ArrowDown from an empty line continues past a single info atom', async () => {
    const editor = await createEditor(
      [
        '## 2. 评价',
        '',
        '<br />',
        '',
        '::: info INFO',
        '',
        'body',
        '',
        ':::',
        '',
        '<br />',
        '',
        '上面这是空行',
        ''
      ].join('\n')
    )
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let emptyBefore = -1
      let infoPos = -1
      let infoSize = 0
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'deskRawBlock' && infoPos < 0) {
          infoPos = pos
          infoSize = node.nodeSize
        }
        if (node.type.name === 'paragraph' && node.content.size === 0 && infoPos < 0) {
          emptyBefore = pos + 1
        }
      })
      expect(emptyBefore).toBeGreaterThan(-1)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, emptyBefore)))
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
      )
      expect(view.state.selection.empty).toBe(false)
      expect(view.dom.querySelectorAll('.desk-raw-block--range-selected')).toHaveLength(1)
      const firstHead = view.state.selection.head
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
      )
      expect(view.state.selection.empty).toBe(false)
      expect(view.state.selection.head).toBeGreaterThan(firstHead)
      expect(Math.max(view.state.selection.from, view.state.selection.to)).toBeGreaterThanOrEqual(
        infoPos + infoSize
      )
    })
  })

  it('Shift+ArrowDown from text before a fence covers the code block', async () => {
    const editor = await createEditor('123\n\n```js\nconsole.log(123)\n```\n\n222\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let textEnd = -1
      let codePos = -1
      let codeSize = 0
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block' && codePos < 0) {
          codePos = pos
          codeSize = node.nodeSize
        }
        if (node.type.name === 'paragraph' && node.textContent === '123') {
          textEnd = pos + 1 + node.content.size
        }
      })
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, textEnd)))
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
      )
      expect(view.state.selection.empty).toBe(false)
      expect(Math.max(view.state.selection.from, view.state.selection.to)).toBeGreaterThanOrEqual(
        codePos + codeSize
      )
      const $from = view.state.doc.resolve(view.state.selection.from)
      const $to = view.state.doc.resolve(view.state.selection.to)
      expect($from.parent.type.name).not.toBe('code_block')
      expect($to.parent.type.name).not.toBe('code_block')
      expect(view.dom.querySelector('.desk-code-block--whole-selected')).toBeTruthy()
    })
  })

  it('Shift+ArrowUp from text below a fence keeps the below anchor and parks above', async () => {
    const editor = await createEditor('123\n\n```js\nconsole.log(123)\n```\n\n222\n')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let below = -1
      let codePos = -1
      let codeSize = 0
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'code_block' && codePos < 0) {
          codePos = pos
          codeSize = node.nodeSize
        }
        if (node.type.name === 'paragraph' && node.textContent === '222') below = pos + 1
      })
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, below)))
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })
      )
      const { selection } = view.state
      expect(selection.empty).toBe(false)
      expect(selection.from).toBeLessThanOrEqual(below)
      expect(selection.to).toBeGreaterThanOrEqual(below)
      expect(selection.from).toBeLessThanOrEqual(codePos)
      expect(selection.to).toBeGreaterThanOrEqual(codePos + codeSize)
      const $from = view.state.doc.resolve(selection.from)
      const $to = view.state.doc.resolve(selection.to)
      expect($from.parent.type.name).not.toBe('code_block')
      expect($to.parent.type.name).not.toBe('code_block')
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
      expect(selection).toBeInstanceOf(BlockRangeSelection)
      expect(selection.anchor).toBe(pos.afterStart)
      expect(selection.head).toBe(pos.raw)
      expect(selection.empty).toBe(false)
      expect(
        ctx.get(editorViewCtx).dom.querySelectorAll('.desk-raw-block--range-selected')
      ).toHaveLength(1)
    })
  })

  it('does not hijack ArrowDown from a non-last visual line', async () => {
    const editor = await createEditor(
      '第一行\n第二行还在段内\n\n<B id="selection" />\n\n下方段落\n'
    )
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

describe('contiguous vertical block ranges', () => {
  it.each([
    ['table', tableMarkdown],
    ['video', '<B id="range" />'],
    ['image', '![image](./pixel.svg)'],
    ['code', '```js\nconst selected = 1\n```'],
    ['divider', '---']
  ])(
    'extends through a whole %s, enters the next paragraph, then reverses each step',
    async (_name, markdown) => {
      const editor = await createEditor(`before\n\n${markdown}\n\nafter\n`)
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { doc } = view.state
        const anchor = doc.firstChild!.nodeSize - 1
        const blockEnd = doc.firstChild!.nodeSize + doc.child(1).nodeSize
        const press = (key: string): void => {
          view.dom.dispatchEvent(
            new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true, cancelable: true })
          )
        }
        view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, anchor)))
        press('ArrowDown')
        expect(view.state.selection.anchor).toBe(anchor)
        expect(view.state.selection.head).toBe(blockEnd)
        expect(view.state.selection.content().content.toString()).toContain(doc.child(1).type.name)
        expect(view.dom.querySelectorAll('.desk-block--range-selected')).toHaveLength(1)
        press('ArrowDown')
        expect(view.state.selection.head).toBe(doc.content.size - 1)
        press('ArrowUp')
        expect(view.state.selection.head).toBe(blockEnd)
        press('ArrowUp')
        expect(view.state.selection.eq(TextSelection.create(doc, anchor))).toBe(true)
        expect(view.dom.querySelectorAll('.desk-block--range-selected')).toHaveLength(0)
      })
    }
  )

  it('expands upward from below a table without moving the anchor, then collapses downward', async () => {
    const editor = await createEditor(`before\n\n${tableMarkdown}\n\nafter\n`)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { doc } = view.state
      const anchor = doc.content.size - doc.lastChild!.nodeSize + 1
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, anchor)))
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })
      )
      expect(view.state.selection.anchor).toBe(anchor)
      expect(view.state.selection.head).toBe(doc.firstChild!.nodeSize)
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
      )
      expect(view.state.selection.eq(TextSelection.create(doc, anchor))).toBe(true)
    })
  })

  it('adds consecutive different blocks one at a time, including at the document edge', async () => {
    const editor = await createEditor(
      `before\n\n${tableMarkdown}\n\n<B id="range" />\n\n\`\`\`js\ncode\n\`\`\`\n`
    )
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { doc } = view.state
      const anchor = doc.firstChild!.nodeSize - 1
      const heads = [anchor]
      let edge = doc.firstChild!.nodeSize
      view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, anchor)))
      for (let index = 1; index < doc.childCount; index += 1) {
        edge += doc.child(index).nodeSize
        view.dom.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
        )
        expect(view.state.selection.head).toBe(edge)
        expect(view.dom.querySelectorAll('.desk-block--range-selected')).toHaveLength(index)
        heads.push(edge)
      }
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
      )
      expect(view.state.selection.head).toBe(doc.content.size)
      for (const head of heads.slice(0, -1).reverse()) {
        view.dom.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })
        )
        expect(view.state.selection.head).toBe(head)
      }
    })
  })

  it.each(['Delete', 'Backspace'])(
    '%s removes the selected table and no following text',
    async (key) => {
      const editor = await createEditor(`before\n\n${tableMarkdown}\n\nafter\n`)
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)))
        view.dom.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
        )
        const selection = view.state.selection
        expect(Selection.fromJSON(view.state.doc, selection.toJSON()).eq(selection)).toBe(true)
        expect(selection.getBookmark().resolve(view.state.doc).eq(selection)).toBe(true)
        view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        expect(view.state.doc.toString()).not.toContain('table')
        expect(view.state.doc.textContent).toBe('beforeafter')
      })
    }
  )

  it('preserves an existing multiline text anchor and does not expand from the wrong end', async () => {
    const editor = await createEditor(`first\n\nsecond\n\n${tableMarkdown}\n\nafter\n`)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const before = TextSelection.create(view.state.doc, 3, 14)
      view.dispatch(view.state.tr.setSelection(before))
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
      )
      expect(view.state.selection.anchor).toBe(3)
      expect(view.state.selection.content().content.toString()).toContain('table')
      view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true })
      )
      expect(view.state.selection.eq(before)).toBe(true)
    })
  })

  it('does not hijack cell text, mouse cell selections, modified keys or readonly editors', async () => {
    const editor = await createEditor(`before\n\n${tableMarkdown}\n\nafter\n`)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let cell = 0
      view.state.doc.descendants((node, pos) => {
        if (node.textContent === 'Cell A' && node.type.name === 'paragraph') cell = pos + 2
      })
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cell)))
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true })
      const plugin = verticalBlockSelectionKey.get(view.state)!
      expect(plugin.props.handleKeyDown!.call(plugin, view, event)).toBe(false)
      expect(view.state.selection.empty).toBe(true)
      view.dispatch(
        view.state.tr.setSelection(
          CellSelection.create(view.state.doc, view.state.doc.firstChild!.nodeSize + 2)
        )
      )
      expect(
        plugin.props.handleKeyDown!.call(
          plugin,
          view,
          new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true })
        )
      ).toBe(false)
      expect(view.state.selection).toBeInstanceOf(CellSelection)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)))
      expect(
        plugin.props.handleKeyDown!.call(
          plugin,
          view,
          new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, metaKey: true })
        )
      ).toBe(false)
      view.setProps({ editable: () => false })
      expect(
        plugin.props.handleKeyDown!.call(
          plugin,
          view,
          new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true })
        )
      ).toBe(false)
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
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, emptyPos + 1)))
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
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos2.afterStart))
      )
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      expect(codeBlockWholeSelectPosition(view.state)).toBe(pos2.code)
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
      expect(view.state.doc.toString()).not.toContain('code_block')
    })
  })

  it('ArrowDown from a whole-selected code chains into the next adjacent code', async () => {
    const editor = await createEditor('上方\n\n```js\none\n```\n\n```ts\ntwo\n```\n\n下方\n')
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
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, pos.afterStart))
      )
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(pos.code)
      expect(view.state.selection.head).not.toBe(pos.afterStart)
      expect(codeBlockWholeSelectPosition(view.state)).toBe(pos.code)
    })
  })

  it('active mindmap island keeps NodeSelection on ArrowDown (does not exit the fence)', async () => {
    const editor = await createEditor('上方段落\n\n```mindmap\n# root\n```\n\n下方段落\n')
    const pos = positions(editor)
    expect(pos.raw).toBeGreaterThan(-1)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const block = view.nodeDOM(pos.raw)
      expect(block).toBeInstanceOf(HTMLElement)
      const host = block as HTMLElement
      host.classList.add('is-mindmap-island-active')
      const canvas = document.createElement('div')
      canvas.className = 'mm-editor'
      canvas.tabIndex = 0
      host.append(canvas)

      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos.raw)))
      canvas.focus()
      expect(document.activeElement).toBe(canvas)

      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect((view.state.selection as NodeSelection).from).toBe(pos.raw)
      expect(document.activeElement).toBe(canvas)
    })
  })
})
