import { Schema, type Node } from '@milkdown/kit/prose/model'
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Transaction
} from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import { wrapInTaskList } from './taskList'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: {},
    bullet_list: { content: 'list_item+', group: 'block' },
    ordered_list: { content: 'list_item+', group: 'block' },
    list_item: { content: 'paragraph block*', attrs: { checked: { default: null } } },
    deskRawBlock: { atom: true, group: 'block' }
  }
})
const paragraph = (text: string): Node =>
  schema.node('paragraph', null, text ? schema.text(text) : undefined)

function apply(doc: Node, from: number, to = from): EditorState {
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to) })
  let transaction: Transaction | undefined
  expect(
    wrapInTaskList(state, (tr) => {
      transaction = tr
    })
  ).toBe(true)
  return state.apply(transaction!)
}

describe('task list toolbar command', () => {
  it('wraps a caret paragraph or multiple selected paragraphs without replacing text', () => {
    const doc = schema.node('doc', null, [paragraph('one'), paragraph('two')])
    const single = apply(doc, 2)
    expect(single.doc.firstChild?.type.name).toBe('bullet_list')
    expect(single.doc.firstChild?.firstChild?.attrs.checked).toBe(false)
    expect(single.doc.lastChild?.type.name).toBe('paragraph')
    const multi = apply(doc, 1, 9)
    expect(multi.doc.firstChild?.childCount).toBe(2)
    multi.doc.firstChild?.forEach((item) => expect(item.attrs.checked).toBe(false))
    expect(multi.doc.textContent).toBe('onetwo')
    expect(multi.doc.textBetween(multi.selection.from, multi.selection.to)).toBe('onetwo')
  })

  it('supports empty lines and retains checked items without creating nested lists', () => {
    const empty = apply(schema.node('doc', null, paragraph('')), 1)
    expect(empty.doc.firstChild?.firstChild?.attrs.checked).toBe(false)
    const doc = schema.node(
      'doc',
      null,
      schema.node('ordered_list', null, [
        schema.node('list_item', null, paragraph('one')),
        schema.node('list_item', { checked: true }, paragraph('two'))
      ])
    )
    const next = apply(doc, 3, 12)
    expect(next.doc.firstChild?.type.name).toBe('ordered_list')
    expect(next.doc.firstChild?.child(0).attrs.checked).toBe(false)
    expect(next.doc.firstChild?.child(1).attrs.checked).toBe(true)
    expect(next.doc.firstChild?.child(0).childCount).toBe(1)
    expect(apply(next.doc, next.selection.from, next.selection.to).doc.eq(next.doc)).toBe(true)
  })

  it('does not mutate protected raw blocks', () => {
    const doc = schema.node('doc', null, [schema.node('deskRawBlock'), paragraph('body')])
    const state = EditorState.create({ doc, selection: NodeSelection.create(doc, 0) })
    expect(wrapInTaskList(state)).toBe(false)
  })
})
