// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { getMarkdown } from '@milkdown/kit/utils'

import { projectRawBlocksForMilkdown, rawBlockProjectionPlugins } from './rawBlockProjection'
import { reconcileMarkdownSource } from './sourcePreservation'

function createEditor(source: string): Promise<{ root: HTMLElement; crepe: Crepe }> {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = new Crepe({ root, defaultValue: projectRawBlocksForMilkdown(source) })
  crepe.editor.use(rawBlockProjectionPlugins)
  return crepe.create().then(() => ({ root, crepe }))
}

function findRawContainerPos(crepe: Crepe): number | null {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let found: number | null = null
    view.state.doc.descendants((node, pos) => {
      if (
        node.type.name === 'deskRawBlock' &&
        node.attrs.kind === 'raw-container' &&
        found == null
      ) {
        found = pos
      }
    })
    return found
  })
}

describe('container source editing', () => {
  it('allows updating a raw-container source while preserving surrounding bytes', async () => {
    const source = '::: details\n\noriginal body\n\n:::\n\nplain paragraph\n'
    const { root, crepe } = await createEditor(source)
    try {
      const baseline = crepe.editor.action(getMarkdown())
      const pos = findRawContainerPos(crepe)
      expect(pos).not.toBeNull()

      const newContainerSource = '::: details 新标题\n\n新正文\n\n:::'
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const node = view.state.doc.nodeAt(pos!)
        expect(node?.type.name).toBe('deskRawBlock')
        view.dispatch(
          view.state.tr.setNodeMarkup(pos!, undefined, {
            ...(node!.attrs as Record<string, unknown>),
            source: newContainerSource
          })
        )
      })

      const current = crepe.editor.action(getMarkdown())
      const reconciled = reconcileMarkdownSource(source, baseline, current)
      expect(reconciled).toContain(newContainerSource)
      expect(reconciled).toContain('plain paragraph')
      // The edited container source must appear verbatim, not normalized.
      expect(reconciled).toContain('::: details 新标题\n\n新正文\n\n:::')
      // The unchanged paragraph must remain byte-identical (no trailing spaces).
      expect(reconciled.endsWith('\nplain paragraph\n')).toBe(true)
    } finally {
      await crepe.destroy()
      root.remove()
    }
  })

  it('keeps non-container raw blocks immutable', async () => {
    const source = '<<< ./shared.md\n\nplain\n'
    const { root, crepe } = await createEditor(source)
    try {
      const pos = crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        let found: number | null = null
        view.state.doc.descendants((node, p) => {
          if (node.type.name === 'deskRawBlock' && found == null) found = p
        })
        return found
      })
      const blocked = crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const node = view.state.doc.nodeAt(pos!)
        const tr = view.state.tr.setNodeMarkup(pos!, undefined, {
          ...(node!.attrs as Record<string, unknown>),
          source: 'changed'
        })
        return view.dispatch(tr)
      })
      expect(blocked).toBeUndefined() // dispatch is void; note the transaction was rejected
      const markdown = crepe.editor.action(getMarkdown())
      expect(markdown).toContain('<<< ./shared.md')
    } finally {
      await crepe.destroy()
      root.remove()
    }
  })
})
