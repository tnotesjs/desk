// @vitest-environment happy-dom

import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { createCodeLineHighlightExtension } from './codeLineHighlightExtension'
import { formatHighlightRanges } from './lineHighlight'

describe('codeLineHighlightExtension', () => {
  it('decorates highlighted lines and toggles via gutter mousedown', () => {
    const changes: string[] = []
    const { extensions } = createCodeLineHighlightExtension({
      initial: '{2}',
      onChange: (encoded) => changes.push(encoded)
    })
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      state: EditorState.create({
        doc: 'one\ntwo\nthree\nfour',
        extensions
      }),
      parent
    })

    expect(view.dom.querySelectorAll('.cm-highlighted-line').length).toBe(1)

    const gutters = [
      ...view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')
    ] as HTMLElement[]
    // CM may include a spacer element; find the one labeled "1".
    const line1 = gutters.find((el) => el.textContent?.trim() === '1')
    expect(line1).toBeTruthy()
    line1!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    expect(changes.at(-1)).toBe('{1-2}')
    expect(view.dom.querySelectorAll('.cm-highlighted-line').length).toBe(2)

    // Toggle line 2 off → only {1}
    const line2 = gutters.find((el) => el.textContent?.trim() === '2')
    line2!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(changes.at(-1)).toBe('{1}')

    view.destroy()
    parent.remove()
  })

  it('prunes highlights when lines are deleted', () => {
    const changes: string[] = []
    const { extensions } = createCodeLineHighlightExtension({
      initial: '{1,4}',
      onChange: (encoded) => changes.push(encoded)
    })
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      state: EditorState.create({
        doc: 'a\nb\nc\nd',
        extensions
      }),
      parent
    })

    // Delete last two lines → line 4 disappears; keep {1}
    view.dispatch({
      changes: { from: view.state.doc.line(3).from, to: view.state.doc.length, insert: '' }
    })
    expect(formatHighlightRanges(new Set([1]))).toBe('{1}')
    // Prune should emit
    expect(changes.some((value) => value === '{1}')).toBe(true)

    view.destroy()
    parent.remove()
  })
})
