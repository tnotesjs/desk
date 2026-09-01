import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

/**
 * Injects a Yuque-style title input into each Crepe code-block tools row and
 * keeps it synced with the `title` attr on `code_block`.
 */
export function createCodeBlockTitlePlugin(): MilkdownPlugin {
  return $prose(() => {
    return new Plugin({
      view: (view) => {
        const sync = (): void => syncCodeBlockTitles(view)
        // Crepe mounts tools asynchronously; retry a few frames after updates.
        let raf = 0
        const schedule = (): void => {
          cancelAnimationFrame(raf)
          raf = requestAnimationFrame(() => {
            sync()
            requestAnimationFrame(sync)
          })
        }
        schedule()
        return {
          update: schedule,
          destroy: () => cancelAnimationFrame(raf)
        }
      }
    })
  })
}

function syncCodeBlockTitles(view: EditorView): void {
  if (view.isDestroyed) return
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return
    const dom = view.nodeDOM(pos) as HTMLElement | null
    if (!dom?.classList?.contains('milkdown-code-block')) return
    const tools = dom.querySelector('.tools') as HTMLElement | null
    if (!tools) return

    let input = tools.querySelector('.desk-code-title') as HTMLInputElement | null
    if (!input) {
      input = document.createElement('input')
      input.type = 'text'
      input.className = 'desk-code-title'
      input.placeholder = '请输入代码块名称'
      input.spellcheck = false
      input.addEventListener('mousedown', (event) => event.stopPropagation())
      input.addEventListener('pointerdown', (event) => event.stopPropagation())
      input.addEventListener('keydown', (event) => event.stopPropagation())
      input.addEventListener('input', () => {
        const title = input!.value
        const currentPos = findCodeBlockPos(view, dom)
        if (currentPos == null) return
        const current = view.state.doc.nodeAt(currentPos)
        if (!current || current.type.name !== 'code_block') return
        if (String(current.attrs.title ?? '') === title) return
        view.dispatch(
          view.state.tr.setNodeMarkup(currentPos, undefined, {
            ...current.attrs,
            title
          })
        )
      })
      tools.prepend(input)
    }

    const title = String(node.attrs.title ?? '')
    if (document.activeElement !== input && input.value !== title) {
      input.value = title
    }
  })
}

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
