// @vitest-environment happy-dom
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { insertDefaultTable } from './insertDefaultTable'

const editors: Crepe[] = []

async function createEditor(content = ''): Promise<Crepe> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = new Crepe({ root, defaultValue: content })
  await editor.create()
  editors.push(editor)
  editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
  })
  return editor
}

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

describe('shared table insertion', () => {
  it('inserts identical empty 2×2 tables from toolbar and slash, without leaving the slash query', async () => {
    const toolbar = await createEditor()
    const slash = await createEditor('/table')
    toolbar.editor.action((ctx) => insertDefaultTable(ctx))
    slash.editor.action((ctx) => insertDefaultTable(ctx, 'slash'))

    const tables = [toolbar, slash].map((editor) =>
      editor.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const table = view.state.doc.firstChild!
        expect(table.type.name).toBe('table')
        expect(table.childCount).toBe(2)
        table.forEach((row) => expect(row.childCount).toBe(2))
        expect(table.textContent).toBe('')
        expect(table.firstChild?.type.name).toBe('table_header_row')
        expect(table.lastChild?.type.name).toBe('table_row')
        expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
        return table.toJSON()
      })
    )
    expect(tables[0]).toEqual(tables[1])
    expect(toolbar.getMarkdown()).toBe(slash.getMarkdown())
    expect(slash.getMarkdown()).not.toContain('/table')
  })

  it('does not modify readonly content', async () => {
    const editor = await createEditor('/table')
    editor.setReadonly(true)
    const before = editor.getMarkdown()
    editor.editor.action((ctx) => insertDefaultTable(ctx, 'slash'))
    expect(editor.getMarkdown()).toBe(before)
  })
})
