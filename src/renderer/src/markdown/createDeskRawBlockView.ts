import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'

import {
  rawBlockSchema as deskRawBlockSchema,
  renderDeskRawBlockElement
} from '../editor/markdown/rawBlockProjection'
import type { ProjectedRawBlockKind } from '../editor/markdown/rawBlockProjection'
import { attachRawBlockBoundaryControls } from './rawBlockInteractions'
import { resolveMarkdownImageUrl } from './markdownAssetUrl'
import { mountRawInclude } from './deskRawBlockView/include'
import { mountRawContainer } from './deskRawBlockView/container'
import { mountRawComponent } from './deskRawBlockView/component'
import { mountRawDiagram } from './deskRawBlockView/diagram'
import { deferUntilVisible } from './deskRawBlockView/deferUntilVisible'
import type { DeskRawBlockViewDeps } from './deskRawBlockView/types'

export type { DeskRawBlockViewDeps } from './deskRawBlockView/types'

export function createDeskRawBlockView(deps: DeskRawBlockViewDeps) {
  return $view(
    deskRawBlockSchema.node,
    () => (node: ProseNode, view: EditorView, getPos: () => number | undefined) => {
      const block = {
        kind: String(node.attrs.kind) as ProjectedRawBlockKind,
        source: String(node.attrs.source),
        hidden: Boolean(node.attrs.hidden)
      }
      const resolveImage = (source: string): string =>
        resolveMarkdownImageUrl(source, deps.knowledgeBaseId(), deps.noteUuid())
      const dom = renderDeskRawBlockElement(block, resolveImage)
      const cleanupTasks: Array<() => void> = []
      let currentRawNode = node
      if (!block.hidden) {
        cleanupTasks.push(attachRawBlockBoundaryControls({ dom, view, getPos }))
      }

      const ctx = {
        block,
        dom,
        view,
        getPos,
        cleanupTasks,
        getCurrentRawNode: () => currentRawNode,
        setCurrentRawNode: (next: ProseNode) => {
          currentRawNode = next
        },
        resolveImage,
        deps
      }

      if (block.kind === 'raw-include') mountRawInclude(ctx)
      if (block.kind === 'raw-container') {
        // Callouts/code-group/swiper mount immediately; footprints (heavy) is deferred inside.
        mountRawContainer(ctx)
      }
      if (block.kind === 'raw-component') {
        deferUntilVisible(dom, cleanupTasks, () => mountRawComponent(ctx))
      }
      if (block.kind === 'raw-diagram') {
        deferUntilVisible(dom, cleanupTasks, () => mountRawDiagram(ctx))
      }
      return {
        dom,
        update: (nextNode) => {
          if (nextNode.type.name !== 'deskRawBlock') return false
          if (nextNode.attrs.source !== currentRawNode.attrs.source) {
            const helper = (
              dom as HTMLElement & {
                __mindmapWriteback?: { acceptWriteback: (source: string) => boolean }
                __codeGroupWriteback?: { acceptWriteback: (source: string) => boolean }
                __swiperWriteback?: { acceptWriteback: (source: string) => boolean }
                __mermaidWriteback?: { acceptWriteback: (source: string) => boolean }
              }
            ).__mindmapWriteback
            if (helper?.acceptWriteback(String(nextNode.attrs.source))) {
              currentRawNode = nextNode
              return true
            }
            const codeGroupHelper = (
              dom as HTMLElement & {
                __codeGroupWriteback?: { acceptWriteback: (source: string) => boolean }
              }
            ).__codeGroupWriteback
            if (codeGroupHelper?.acceptWriteback(String(nextNode.attrs.source))) {
              currentRawNode = nextNode
              return true
            }
            const swiperHelper = (
              dom as HTMLElement & {
                __swiperWriteback?: { acceptWriteback: (source: string) => boolean }
              }
            ).__swiperWriteback
            if (swiperHelper?.acceptWriteback(String(nextNode.attrs.source))) {
              currentRawNode = nextNode
              return true
            }
            const mermaidHelper = (
              dom as HTMLElement & {
                __mermaidWriteback?: { acceptWriteback: (source: string) => boolean }
              }
            ).__mermaidWriteback
            if (mermaidHelper?.acceptWriteback(String(nextNode.attrs.source))) {
              currentRawNode = nextNode
              return true
            }
            return false
          }
          currentRawNode = nextNode
          return true
        },
        selectNode: () => dom.classList.add('ProseMirror-selectednode'),
        deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
        ignoreMutation: () => true,
        destroy: () => cleanupTasks.splice(0).forEach((cleanup) => cleanup()),
        stopEvent: (event) => {
          const target = event.target as Element | null
          // CodeMirror / structured fields own keyboard input inside the editor.
          if (
            target?.closest('.desk-raw-block__editor, .desk-raw-block__include-cm, .desk-code-tab')
          )
            return true
          // Mindmap / Mermaid chrome and canvas editing must keep native events
          // (including paste images — must not reach Milkdown upload plugin).
          if (
            target?.closest(
              [
                '.desk-raw-block__component-preview',
                '.mindmap-preview',
                '.mindmap-preview-actions',
                '.mindmap-preview-action',
                '[data-view-tab]',
                '.focus-breadcrumbs',
                '.focus-crumb',
                '.focus-sibling-menu',
                '.mm-editor',
                '.mm-overlay',
                '.outline-view',
                '.markdown-view',
                '.selection-toolbar',
                '.canvas-context-menu',
                '.link-popover',
                '[contenteditable="true"]'
              ].join(', ')
            )
          )
            return true
          if (event.type === 'paste' && target?.closest('.desk-raw-block--mindmap-editable')) {
            return true
          }
          // Let native details toggles and links inside the rendered container
          // keep their default behaviour instead of being turned into a node
          // selection; everything else selects the atom so it stays swipeable.
          if (target?.closest('summary, a, button, textarea, input, .desk-raw-block__boundary-hit'))
            return true
          return false
        }
      }
    }
  )
}
