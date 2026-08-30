// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, editorStateCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'

import { createReadonlyTransactionGuard } from './readonlyGuard'

const editors: Editor[] = []

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

describe('readonly transaction guard', () => {
  it('rejects mutations but permits selection and external synchronization', async () => {
    let readOnly = true
    let externalSync = false
    const root = document.createElement('div')
    document.body.append(root)
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, 'alpha')
      })
      .use(commonmark)
      .use(
        createReadonlyTransactionGuard({
          isReadOnly: () => readOnly,
          isExternalSync: () => externalSync
        })
      )
    editors.push(editor)
    await editor.create()

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const original = ctx.get(editorStateCtx).doc.textContent
      view.dispatch(view.state.tr.insertText('blocked', 1))
      expect(view.state.doc.textContent).toBe(original)

      view.dispatch(view.state.tr.setSelection(view.state.selection))
      expect(view.state.doc.textContent).toBe(original)

      externalSync = true
      view.dispatch(view.state.tr.insertText('external-', 1))
      externalSync = false
      expect(view.state.doc.textContent).toBe('external-alpha')

      readOnly = false
      view.dispatch(view.state.tr.insertText('edit-', 1))
      expect(view.state.doc.textContent).toBe('edit-external-alpha')
    })
  })
})
