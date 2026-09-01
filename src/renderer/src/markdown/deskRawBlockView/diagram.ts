import { NodeSelection } from '@milkdown/kit/prose/state'

import {
  renderDiagram,
  parseFencedCode,
  rebuildMermaidFence
} from '../../editor/markdown/diagramRenderer'
import { mindmapPreviewMarkdown, rebuildMindmapFence } from '../../editor/markdown/mindmapFence'
import { mountMermaidPreview, mountMindmapPreview } from '../../editor/markdown/componentPreview'
import { resolveMarkdownImageUrl } from '../markdownAssetUrl'
import { attachRawSourceEditor } from '../attachRawSourceEditor'
import type { DeskRawBlockMountContext } from './types'

export function mountRawDiagram(ctx: DeskRawBlockMountContext): void {
  const { block, dom, view, getPos, cleanupTasks, deps } = ctx

  const fence = parseFencedCode(block.source)
  if (fence.lang === 'mermaid') {
    // Drop --diagram chrome (always-on border/panel); shared Mermaid owns hover frame.
    dom.classList.remove('desk-raw-block--diagram')
    dom.classList.add('desk-raw-block--mermaid')
    dom.replaceChildren()
    const previewHost = document.createElement('div')
    previewHost.className = 'desk-raw-block__component-preview'
    dom.append(previewHost)

    let currentSource = block.source
    const applyCenterChange = (center: boolean): void => {
      // Readonly / view mode: Mermaid keeps session-local state; skip write-back.
      if (deps.isEffectivelyReadOnly()) return
      const nextSource = rebuildMermaidFence(currentSource, center)
      if (nextSource === currentSource) return
      const position = getPos()
      if (position == null) return
      const currentNode = view.state.doc.nodeAt(position)
      if (currentNode?.type.name !== 'deskRawBlock') return
      currentSource = nextSource
      view.dispatch(
        view.state.tr.setNodeMarkup(position, undefined, {
          ...(currentNode.attrs as Record<string, unknown>),
          source: nextSource
        })
      )
    }

    const mounted = mountMermaidPreview(previewHost, {
      source: fence.code,
      center: fence.center,
      onCenterChange: applyCenterChange
    })
    cleanupTasks.push(() => mounted.unmount())
    cleanupTasks.push(
      attachRawSourceEditor(
        {
          dom,
          source: block.source,
          view,
          getPos,
          label: '编辑 Mermaid',
          structuredMermaid: true,
          renderPreview: (source) => {
            currentSource = source
            const next = parseFencedCode(source)
            mounted.update({
              source: next.code,
              center: next.center,
              onCenterChange: applyCenterChange
            })
          }
        },
        deps
      )
    )
  } else if (fence.lang === 'mindmap') {
    dom.classList.remove('desk-raw-block--diagram')
    dom.classList.add('desk-raw-block--mindmap')
    if (!deps.isEffectivelyReadOnly()) {
      dom.classList.add('desk-raw-block--mindmap-editable')
    }
    dom.replaceChildren()
    const previewHost = document.createElement('div')
    previewHost.className = 'desk-raw-block__component-preview'
    dom.append(previewHost)

    let currentSource = block.source
    let writingBack = false
    const preview = mindmapPreviewMarkdown(currentSource)
    const editable = !deps.isEffectivelyReadOnly()

    const resolveMindmapImage = (src: string): string =>
      resolveMarkdownImageUrl(src, deps.knowledgeBaseId(), deps.noteUuid()) || src

    const writeMindmapAsset = async (
      blob: Blob
    ): Promise<{ relativePath: string; alt?: string }> => {
      const type = blob.type || 'image/png'
      const ext =
        type === 'image/jpeg'
          ? 'jpg'
          : type === 'image/gif'
            ? 'gif'
            : type === 'image/webp'
              ? 'webp'
              : 'png'
      const file =
        blob instanceof File ? blob : new File([blob], `paste-${Date.now()}.${ext}`, { type })
      const uploaded = await deps.uploadImage(file)
      return {
        relativePath: uploaded.src,
        alt: uploaded.alt
      }
    }

    const writeFence = (nextSource: string): void => {
      if (deps.isEffectivelyReadOnly()) return
      if (nextSource === currentSource) return
      const position = getPos()
      if (position == null) return
      const currentNode = view.state.doc.nodeAt(position)
      if (currentNode?.type.name !== 'deskRawBlock') return
      writingBack = true
      currentSource = nextSource
      view.dispatch(
        view.state.tr.setNodeMarkup(position, undefined, {
          ...(currentNode.attrs as Record<string, unknown>),
          source: nextSource
        })
      )
      writingBack = false
    }

    const mindmapHandlers = {
      onMarkdownChange: (markdown: string) => {
        writeFence(rebuildMindmapFence(currentSource, { markdown }))
      },
      onExpandLevelChange: (level: number) => {
        writeFence(rebuildMindmapFence(currentSource, { initialExpandLevel: level }))
      },
      resolveImageSrc: resolveMindmapImage,
      writeAsset: editable ? writeMindmapAsset : undefined
    }

    const mounted = mountMindmapPreview(previewHost, {
      source: preview.markdown,
      initialExpandLevel: preview.initialExpandLevel,
      editable,
      expandLevelControl: editable,
      ...mindmapHandlers
    })
    cleanupTasks.push(() => mounted.unmount())

    // Interaction island: click inside focuses the canvas editor so Tab/Enter work.
    // Also move PM off TextSelection so the body virtual caret does not linger.
    if (editable) {
      const activateIsland = (event: Event): void => {
        const target = event.target as Element | null
        // Toolbar / breadcrumbs must keep the click (view switch, expand, fullscreen).
        // Focusing .mm-editor here steals the gesture and Electron drops the click.
        if (
          target?.closest(
            '.mindmap-preview-actions, .mindmap-preview-tabs, .mindmap-preview-action, [data-view-tab], .focus-breadcrumbs, .focus-crumb, .focus-sibling-menu'
          )
        ) {
          return
        }
        dom.classList.add('is-mindmap-island-active')
        const position = getPos()
        if (position != null && view.editable) {
          const node = view.state.doc.nodeAt(position)
          const sel = view.state.selection
          if (
            node?.type.name === 'deskRawBlock' &&
            (!(sel instanceof NodeSelection) || sel.from !== position)
          ) {
            view.dispatch(
              view.state.tr.setSelection(NodeSelection.create(view.state.doc, position))
            )
          }
        }
        const editorEl = previewHost.querySelector<HTMLElement>('.mm-editor')
        editorEl?.focus({ preventScroll: true })
      }
      const deactivateIsland = (event: PointerEvent): void => {
        if (event.target instanceof Node && dom.contains(event.target)) return
        dom.classList.remove('is-mindmap-island-active')
      }
      previewHost.addEventListener('pointerdown', activateIsland)
      document.addEventListener('pointerdown', deactivateIsland, true)
      cleanupTasks.push(() => {
        previewHost.removeEventListener('pointerdown', activateIsland)
        document.removeEventListener('pointerdown', deactivateIsland, true)
        dom.classList.remove('is-mindmap-island-active')
      })
    }

    // Keep nodeView alive across our own writebacks so canvas edit state survives.
    const baseUpdate = {
      acceptWriteback: (nextSource: string): boolean => {
        if (!writingBack && nextSource !== currentSource) return false
        currentSource = nextSource
        const nextPreview = mindmapPreviewMarkdown(nextSource)
        mounted.update({
          source: nextPreview.markdown,
          initialExpandLevel: nextPreview.initialExpandLevel,
          editable,
          expandLevelControl: editable,
          ...mindmapHandlers
        })
        return true
      }
    }
    ;(dom as HTMLElement & { __mindmapWriteback?: typeof baseUpdate }).__mindmapWriteback =
      baseUpdate
    cleanupTasks.push(() => {
      delete (dom as HTMLElement & { __mindmapWriteback?: typeof baseUpdate }).__mindmapWriteback
    })
  } else {
    const diagramEl = dom.querySelector('.desk-diagram') as HTMLElement | null
    let renderToken = 0
    let currentDiagram: { destroy?: () => void } | null = null
    const renderInto = (source: string): void => {
      if (!diagramEl) return
      const token = ++renderToken
      currentDiagram?.destroy?.()
      currentDiagram = null
      void renderDiagram(source).then((rendered) => {
        if (token !== renderToken) {
          rendered.destroy?.()
          return
        }
        currentDiagram = rendered
        diagramEl.replaceChildren(rendered.node)
        const active = rendered.activate
        if (active) {
          setTimeout(() => {
            if (token === renderToken) active(rendered.node)
          }, 80)
        }
      })
    }
    renderInto(block.source)
    const editorCleanup = attachRawSourceEditor(
      {
        dom,
        source: block.source,
        view,
        getPos,
        label: '编辑图表源码',
        renderPreview: renderInto
      },
      deps
    )
    cleanupTasks.push(() => {
      editorCleanup()
      currentDiagram?.destroy?.()
    })
  }
}
