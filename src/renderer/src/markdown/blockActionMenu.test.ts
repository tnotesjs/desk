// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { NodeSelection } from '@milkdown/kit/prose/state'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'

import {
  projectRawBlocksForMilkdown,
  rawBlockProjectionPlugins
} from '../editor/markdown/rawBlockProjection'
import {
  canShowBlockHandle,
  createBlockDeleteTransaction,
  installBlockHandleClickController,
  resolveBlockActionTarget,
  serializeBlockForClipboard
} from './blockActionMenu'

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

async function setup(source = '<B id="menu" />\n'): Promise<{
  root: HTMLDivElement
  view: EditorView
  grip: HTMLElement
  serialize: (document: ProseMirrorNode) => string
}> {
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
  editors.push(editor)
  await editor.create()
  const view = editor.action((ctx) => ctx.get(editorViewCtx))
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  handle.innerHTML = '<div class="operation-item"></div><div class="operation-item"></div>'
  root.append(handle)
  return {
    root,
    view,
    grip: handle.lastElementChild as HTMLElement,
    serialize: editor.action((ctx) => ctx.get(serializerCtx))
  }
}

describe('block handle click controller', () => {
  it.each([
    ['paragraph', '正文 **加粗**\n', 0],
    ['heading', '## 二级标题\n', 0],
    ['list_item', '- 第一项\n  - 子项\n- 第二项\n', 1],
    ['bullet_list', '- 第一项\n- 第二项\n', 0],
    ['ordered_list', '3. 有序列表\n', 0],
    ['list_item', '- [x] 已完成\n- [ ] 待完成\n', 1],
    ['blockquote', '> 引用文字\n', 0],
    ['code_block', '```ts\nconst value = 1\n```\n', 0],
    ['table', '| 标题 |\n| --- |\n| 内容 |\n', 0],
    ['hr', '---\n', 0],
    ['paragraph', '![图片](./image.png)\n', 0]
  ])('opens the same menu for a %s block', async (type, source, position) => {
    const { root, view, grip } = await setup(String(source))
    const from = Number(position)
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, from)))
    expect(view.state.doc.nodeAt(from)?.type.name).toBe(type)
    const onClick = vi.fn()
    const cleanup = installBlockHandleClickController({ root, getView: () => view, onClick })
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(onClick.mock.calls[0][0].position).toBe(from)
    cleanup()
  })

  it('keeps body blocks and lower-level headings operable but excludes level-one headings', async () => {
    const { view } = await setup()
    const { schema } = view.state
    expect(canShowBlockHandle(schema.nodes.heading.create({ level: 1 }))).toBe(false)
    expect(canShowBlockHandle(schema.nodes.heading.create({ level: 2 }))).toBe(true)
    expect(canShowBlockHandle(schema.nodes.paragraph.create())).toBe(true)
    expect(canShowBlockHandle(view.state.doc.firstChild!)).toBe(true)
  })

  it.each([
    '# [0001. 标题](https://github.com/tnotesjs/desk)\n',
    '<!-- region:toc -->\n- [正文](#正文)\n<!-- endregion:toc -->\n'
  ])('excludes generated navigation and ignores stale handle clicks for %s', async (source) => {
    const { root, view, grip } = await setup(source)
    expect(canShowBlockHandle(view.state.doc.firstChild!)).toBe(false)
    const onClick = vi.fn()
    const cleanup = installBlockHandleClickController({ root, getView: () => view, onClick })
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    expect(onClick).not.toHaveBeenCalled()
    cleanup()
  })

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

describe('block menu actions', () => {
  it.each([
    ['正文 **加粗**\n', 0, '正文 **加粗**'],
    ['## 二级标题\n', 0, '## 二级标题'],
    ['> 引用文字\n', 0, '> 引用文字'],
    ['```ts\nconst value = 1\n```\n', 0, '```ts\nconst value = 1\n```'],
    ['- 第一项\n  - 子项\n- 第二项\n', 1, '* 第一项\n  * 子项'],
    ['- [x] 已完成\n- [ ] 待完成\n', 1, '* [x] 已完成'],
    ['<B id="原样保留" />  \r\n', 0, '<B id="原样保留" />']
  ])('copies Markdown, not empty text, for %s', async (source, position, expected) => {
    const { view, serialize } = await setup(String(source))
    expect(serializeBlockForClipboard(view.state, Number(position), serialize)?.trimEnd()).toBe(
      expected
    )
  })

  it('copies a later ordered item with its own number and without its siblings', async () => {
    const { view, serialize } = await setup('3. 第一项\n4. 第二项\n5. 第三项\n')
    let position = -1
    view.state.doc.descendants((node, from) => {
      if (node.type.name === 'list_item' && node.textContent === '第二项') position = from
    })
    expect(serializeBlockForClipboard(view.state, position, serialize)?.trimEnd()).toBe('4. 第二项')
  })

  it('removes exactly the selected item including nested children, then removes an empty list', async () => {
    const { view } = await setup('- 第一项\n  - 子项\n- 第二项\n\n末尾段落\n')
    view.dispatch(createBlockDeleteTransaction(view.state, 1)!)
    expect(view.state.doc.textContent).toBe('第二项末尾段落')
    expect(view.state.doc.firstChild?.childCount).toBe(1)
    view.dispatch(createBlockDeleteTransaction(view.state, 1)!)
    expect(view.state.doc.childCount).toBe(1)
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.textContent).toBe('末尾段落')
    view.state.doc.check()
  })

  it('can delete the only paragraph while leaving a valid editable document', async () => {
    const { view } = await setup('唯一段落\n')
    view.dispatch(createBlockDeleteTransaction(view.state, 0)!)
    expect(view.state.doc.textContent).toBe('')
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    view.state.doc.check()
  })

  it('tracks a normal block when positions shift and rejects a removed target', async () => {
    const { view } = await setup('目标段落\n\n后续段落\n')
    const target = { position: 0, dom: view.nodeDOM(0) as HTMLElement }
    const before = view.state.schema.nodes.paragraph.create(null, view.state.schema.text('新段落'))
    view.dispatch(view.state.tr.insert(0, before))
    const resolved = resolveBlockActionTarget(view, target)
    expect(resolved?.position).toBe(before.nodeSize)
    expect(resolved?.node.textContent).toBe('目标段落')
    view.dispatch(createBlockDeleteTransaction(view.state, resolved!.position)!)
    expect(resolveBlockActionTarget(view, target)).toBeNull()
    expect(view.state.doc.textContent).toBe('新段落后续段落')
  })

  it('does not copy or delete protected generated headings', async () => {
    const { view, serialize } = await setup('# 自动标题\n')
    expect(serializeBlockForClipboard(view.state, 0, serialize)).toBeNull()
    expect(createBlockDeleteTransaction(view.state, 0)).toBeNull()
  })
})
