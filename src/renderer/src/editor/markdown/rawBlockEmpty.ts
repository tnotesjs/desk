/**
 * Decides whether a deskRawBlock's source counts as "empty" for the
 * empty-Backspace-removes-block gesture (aligned with Crepe code blocks).
 *
 * Rules:
 * - Whitespace-only source → empty.
 * - VitePress-style `:::` / `::::` container whose body (between open/close
 *   fences) is whitespace-only → empty (default titles on the open line do
 *   not count as content).
 * - Everything else (components, diagram fences, code-group with stubs, …)
 *   → empty only after the source is fully cleared.
 */

import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

const CONTAINER_OPEN = /^ {0,3}(:{3,})(.*)$/

export function isEmptyRawBlockSource(source: string): boolean {
  const normalized = source.replace(/\r\n?/g, '\n')
  if (normalized.trim() === '') return true

  const lines = normalized.split('\n')
  let openIdx = -1
  let openColons = ''
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(CONTAINER_OPEN)
    if (!match) continue
    openIdx = i
    openColons = match[1]
    break
  }
  if (openIdx < 0) return false
  if (lines.slice(0, openIdx).some((line) => line.trim() !== '')) return false

  const closeRe = new RegExp(`^ {0,3}${openColons}[ \\t]*$`)
  let closeIdx = -1
  for (let i = lines.length - 1; i > openIdx; i--) {
    if (closeRe.test(lines[i])) {
      closeIdx = i
      break
    }
  }
  if (closeIdx < 0) return false
  if (lines.slice(closeIdx + 1).some((line) => line.trim() !== '')) return false

  return lines.slice(openIdx + 1, closeIdx).every((line) => line.trim() === '')
}

/** Deletes a deskRawBlock atom and parks the caret nearby (code-block empty-Backspace UX). */
export function deleteDeskRawBlockAt(view: EditorView, position: number): boolean {
  const node = view.state.doc.nodeAt(position)
  if (node?.type.name !== 'deskRawBlock') return false
  const end = position + node.nodeSize
  const paragraph = view.state.schema.nodes.paragraph
  let tr = view.state.tr.delete(position, end)
  if (paragraph && tr.doc.content.size === 0) {
    tr = tr.insert(0, paragraph.create())
  }
  tr = tr.setSelection(
    TextSelection.near(tr.doc.resolve(Math.min(position, tr.doc.content.size)), -1)
  )
  view.dispatch(tr.scrollIntoView())
  view.focus()
  return true
}
