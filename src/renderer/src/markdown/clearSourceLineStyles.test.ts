import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { sourceLineStyleChanges } from './clearSourceLineStyles'

function clear(source: string, anchor = 0, head = anchor): string {
  const state = EditorState.create({ doc: source, selection: { anchor, head } })
  return state.update({ changes: sourceLineStyleChanges(state) }).state.doc.toString()
}

describe('clear source line styles', () => {
  it.each([
    ['**bold** *italic* ~~strike~~', 'bold italic strike'],
    ['__bold__ _italic_ ~~strike~~', 'bold italic strike'],
    ['***both*** ~~**all**~~', 'both all'],
    [
      '## **Heading** [*label*](https://example.com/a_b) `**code**`',
      '## Heading [label](https://example.com/a_b) `**code**`'
    ],
    ['- [x] **bold** and ![image](a_b.png)', '- [x] bold and ![image](a_b.png)'],
    ['> ~~quote~~ <br /> **line**', '> quote <br /> line'],
    ['***', '***'],
    ['a_b_c a*b \\*literal\\*', 'a_b_c a*b \\*literal\\*'],
    ['`**code** _literal_ ~~literal~~` **bold**', '`**code** _literal_ ~~literal~~` bold']
  ])('clears only parsed inline styles in %j', (source, expected) => {
    expect(clear(source)).toBe(expected)
  })

  it('clears the entire caret line without touching adjacent lines', () => {
    const source = '**first**\n*second* ~~more~~\n**third**'
    expect(clear(source, source.indexOf('second') + 2)).toBe('**first**\nsecond more\n**third**')
  })

  it('clears all touched lines for a forward or backward selection', () => {
    const source = '**first**\n*second*\n~~third~~\n**last**'
    const anchor = source.indexOf('irst')
    const head = source.indexOf('hird')
    const expected = 'first\nsecond\nthird\n**last**'
    expect(clear(source, anchor, head)).toBe(expected)
    expect(clear(source, head, anchor)).toBe(expected)
  })

  it('does not include the next line when a selection ends at its start', () => {
    const source = '**first**\n*second*\n~~third~~'
    expect(clear(source, 0, source.indexOf('~~'))).toBe('first\nsecond\n~~third~~')
  })

  it.each(['**', '_', '~~', '***'])(
    'preserves %s styles outside a partially selected multi-line span',
    (marker) => {
      const source = `${marker}first\nsecond\nthird${marker}`
      expect(clear(source, source.indexOf('second'))).toBe(
        `${marker}first${marker}\nsecond\n${marker}third${marker}`
      )
      expect(clear(source, 0)).toBe(`first\n${marker}second\nthird${marker}`)
      expect(clear(source, source.indexOf('third'))).toBe(`${marker}first\nsecond${marker}\nthird`)
    }
  )

  it('keeps fenced and indented code, frontmatter, components, and reference targets literal', () => {
    for (const source of [
      '```md\n**bold** *italic* ~~strike~~\n```',
      '    **bold** *italic* ~~strike~~',
      '---\ntitle: "**bold**"\n---',
      '<Component title="**bold**" />',
      '[ref]: https://example.com "**bold**"'
    ]) {
      expect(clear(source, source.indexOf('bold'))).toBe(source)
    }
  })

  it('maps the caret across delimiter removal', () => {
    const state = EditorState.create({ doc: '**bold** and *italic*', selection: { anchor: 4 } })
    const next = state.update({ changes: sourceLineStyleChanges(state) }).state
    expect(next.doc.toString()).toBe('bold and italic')
    expect(next.selection.main.head).toBe(2)
  })

  it('keeps blockquote prefixes outside reopened multiline styles', () => {
    const source = '> **first\n> second\n> third**'
    expect(clear(source, source.indexOf('second'))).toBe('> **first**\n> second\n> **third**')
  })
})
