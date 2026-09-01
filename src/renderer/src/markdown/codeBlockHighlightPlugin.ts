import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { EditorView as CodeMirrorView } from '@codemirror/view'

import { createCodeLineHighlightExtension } from '../editor/markdown/codeLineHighlightExtension'

function findCodeBlockPos(view: EditorView, dom: HTMLElement): number | null {
  try {
    const pos = view.posAtDOM(dom, 0)
    const $pos = view.state.doc.resolve(pos)
    for (let depth = $pos.depth; depth >= 0; depth -= 1) {
      const node = $pos.node(depth)
      if (node.type.name === 'code_block') return $pos.before(depth)
    }
  } catch {
    return null
  }
  return null
}

function findCodeBlockDomFromCm(cm: CodeMirrorView): HTMLElement | null {
  return cm.dom.closest('.milkdown-code-block') as HTMLElement | null
}

/**
 * Shared Crepe code-block line-highlight wiring.
 * - `extensions` → pass to `Crepe.Feature.CodeMirror` featureConfigs
 * - `plugin` → `editor.editor.use(plugin)` to sync PM attrs ↔ CM
 */
export function createCodeBlockHighlightBundle(): {
  extensions: ReturnType<typeof createCodeLineHighlightExtension>['extensions']
  plugin: MilkdownPlugin
} {
  let latestPmView: EditorView | null = null

  const highlight = createCodeLineHighlightExtension({
    provideLineNumbers: false,
    readOnly: () => !(latestPmView?.editable ?? true),
    onChange: (encoded, cm) => {
      const pm = latestPmView
      if (!pm || pm.isDestroyed) return
      const block = findCodeBlockDomFromCm(cm)
      if (!block) return
      const pos = findCodeBlockPos(pm, block)
      if (pos == null) return
      const node = pm.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'code_block') return
      if (String(node.attrs.highlights ?? '') === encoded) return
      pm.dispatch(
        pm.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          highlights: encoded
        })
      )
    }
  })

  const plugin = $prose(() => {
    return new Plugin({
      view: (view) => {
        latestPmView = view
        let raf = 0
        let bootFrames = 0
        const sync = (): void => {
          if (view.isDestroyed) return
          view.state.doc.descendants((node, pos) => {
            if (node.type.name !== 'code_block') return
            const dom = view.nodeDOM(pos) as HTMLElement | null
            if (!dom?.classList?.contains('milkdown-code-block')) return
            const cm = CodeMirrorView.findFromDOM(dom)
            if (!cm) return
            highlight.setHighlights(cm, String(node.attrs.highlights ?? ''))
          })
        }
        const schedule = (): void => {
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(() => {
            sync()
            requestAnimationFrame(sync)
          })
        }
        const boot = (): void => {
          sync()
          bootFrames += 1
          if (bootFrames < 10 && !view.isDestroyed) {
            raf = requestAnimationFrame(boot)
          }
        }
        boot()
        return {
          update: (current, previous) => {
            latestPmView = current
            if (!previous.doc.eq(current.state.doc)) schedule()
          },
          destroy: () => {
            cancelAnimationFrame(raf)
            if (latestPmView === view) latestPmView = null
          }
        }
      }
    })
  })

  return { extensions: highlight.extensions, plugin }
}
