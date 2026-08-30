// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor, defaultValueCtx, editorStateCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'

import {
  projectRawBlocksForMilkdown,
  rawBlockProjectionPlugins
} from '../editor/markdown/rawBlockProjection'
import { installBlockHandleClickController } from './blockActionMenu'

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

async function setup(): Promise<{
  root: HTMLDivElement
  view: EditorView
  grip: HTMLElement
}> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, projectRawBlocksForMilkdown('<B id="menu" />\n'))
    })
    .use(commonmark)
    .use(gfm)
    .use(rawBlockProjectionPlugins)
  editors.push(editor)
  await editor.create()
  const view = editor.action((ctx) => ctx.get(editorViewCtx))
  let rawPosition = -1
  editor.action((ctx) => {
    ctx.get(editorStateCtx).doc.descendants((node, position) => {
      if (node.type.name === 'deskRawBlock') rawPosition = position
    })
  })
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, rawPosition)))
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  handle.innerHTML = '<div class="operation-item"></div><div class="operation-item"></div>'
  root.append(handle)
  return { root, view, grip: handle.lastElementChild as HTMLElement }
}

describe('block handle click controller', () => {
  it('opens on a short six-dot click but not after crossing the drag threshold', async () => {
    const { root, view, grip } = await setup()
    const onClick = vi.fn()
    const cleanup = installBlockHandleClickController({ root, getView: () => view, onClick })

    grip.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    )
    grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 11, clientY: 11 }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick.mock.calls[0]?.[0].position).toBe(0)

    grip.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    )
    grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 20, clientY: 10 }))
    grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 20, clientY: 10 }))
    expect(onClick).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
