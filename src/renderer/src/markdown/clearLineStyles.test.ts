import { Schema } from '@milkdown/kit/prose/model'
import {
  AllSelection,
  EditorState,
  TextSelection,
  type Transaction
} from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'
import { clearLineStyles } from './clearLineStyles'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block', attrs: { level: { default: 2 } } },
    blockquote: { content: 'block+', group: 'block' },
    code_block: { content: 'text*', group: 'block', code: true, marks: '' },
    hardbreak: { inline: true, group: 'inline' },
    text: { group: 'inline' }
  },
  marks: {
    strong: {},
    emphasis: {},
    strike_through: {},
    link: { attrs: { href: { default: '/keep' } } },
    inlineCode: { code: true }
  }
})
const styles = [
  schema.marks.strong.create(),
  schema.marks.emphasis.create(),
  schema.marks.strike_through.create()
]
const styled = (text: string): ReturnType<Schema['text']> => schema.text(text, styles)

function apply(state: EditorState): EditorState {
  let transaction: Transaction | undefined
  expect(
    clearLineStyles(state, (tr) => {
      transaction = tr
    })
  ).toBe(true)
  return state.apply(transaction!)
}

describe('clear visual line styles', () => {
  it('clears the caret line and stored styles while preserving text, links, inline code and heading level', () => {
    const doc = schema.node('doc', null, [
      schema.node(
        'heading',
        { level: 2 },
        schema.text('title', [
          ...styles,
          schema.marks.link.create(),
          schema.marks.inlineCode.create()
        ])
      ),
      schema.node('paragraph', null, styled('next'))
    ])
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3),
      storedMarks: styles
    })
    const next = apply(state)
    expect(next.doc.firstChild?.attrs.level).toBe(2)
    expect(next.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name)).toEqual([
      'link',
      'inlineCode'
    ])
    expect(next.doc.lastChild?.firstChild?.marks).toEqual(styles)
    expect(next.doc.textContent).toBe(doc.textContent)
    expect(next.selection.from).toBe(3)
    const typed = next.apply(next.tr.insertText('!'))
    expect(typed.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name)).toEqual([
      'link',
      'inlineCode'
    ])
  })

  it.each(['\n', 'hardbreak'])(
    'treats %s as a logical line boundary without clearing adjacent lines',
    (breakKind) => {
      const content =
        breakKind === '\n'
          ? [styled('first\nsecond\nthird')]
          : [
              styled('first'),
              schema.node('hardbreak'),
              styled('second'),
              schema.node('hardbreak'),
              styled('third')
            ]
      const doc = schema.node('doc', null, schema.node('paragraph', null, content))
      const next = apply(EditorState.create({ doc, selection: TextSelection.create(doc, 9) }))
      expect(next.doc.rangeHasMark(1, 6, schema.marks.strong)).toBe(true)
      for (const mark of styles) expect(next.doc.rangeHasMark(7, 13, mark.type)).toBe(false)
      expect(next.doc.rangeHasMark(14, 19, schema.marks.strong)).toBe(true)
    }
  )

  it('clears full touched lines for backward multi-line selection and leaves other lines intact', () => {
    const doc = schema.node(
      'doc',
      null,
      ['first', 'second', 'third'].map((text) => schema.node('paragraph', null, styled(text)))
    )
    const next = apply(EditorState.create({ doc, selection: TextSelection.create(doc, 10, 3) }))
    expect(next.doc.child(0).firstChild?.marks).toEqual([])
    expect(next.doc.child(1).firstChild?.marks).toEqual([])
    expect(next.doc.child(2).firstChild?.marks).toEqual(styles)
  })

  it('excludes the next line when the selection ends at its start', () => {
    const doc = schema.node(
      'doc',
      null,
      ['first', 'second'].map((text) => schema.node('paragraph', null, styled(text)))
    )
    const next = apply(EditorState.create({ doc, selection: TextSelection.create(doc, 3, 8) }))
    expect(next.doc.child(0).firstChild?.marks).toEqual([])
    expect(next.doc.child(1).firstChild?.marks).toEqual(styles)
  })

  it('supports select-all through nested blocks but leaves code untouched', () => {
    const doc = schema.node('doc', null, [
      schema.node('blockquote', null, schema.node('paragraph', null, styled('quote'))),
      schema.node('code_block', null, schema.text('**literal**'))
    ])
    const next = apply(EditorState.create({ doc, selection: new AllSelection(doc) }))
    expect(next.doc.firstChild?.firstChild?.firstChild?.marks).toEqual([])
    expect(next.doc.lastChild?.textContent).toBe('**literal**')
  })
})
