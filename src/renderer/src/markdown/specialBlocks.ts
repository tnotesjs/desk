import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'

import type { DeskTocNode } from '../../../shared/contracts'
import type { MarkdownRenderContext, VisualBlock } from './visualBlocks'

export interface SpecialBlockHandlers {
  openNote(noteUuid: string): void
}

function resultValue<T>(result: Awaited<ReturnType<typeof window.desk.attachments.readText>>): T {
  if (result.ok) return result.value as T
  throw new Error(result.error.message)
}

function fenceParts(source: string): { info: string; content: string } {
  const lines = source.split('\n')
  const info = (lines.shift() ?? '').replace(/^\s*(?:```|~~~)\s*/, '').trim()
  if (lines.length > 0 && /^\s*(?:```|~~~)\s*$/.test(lines[lines.length - 1])) lines.pop()
  return { info, content: lines.join('\n') }
}

function referenceFrom(content: string): { path: string; title?: string } | null {
  const match = content.trim().match(/^<<<\s+(\S+)(?:\s+\[([^\]]+)])?\s*$/)
  return match ? { path: match[1], title: match[2] } : null
}

async function readReference(context: MarkdownRenderContext, reference: string): Promise<string> {
  return resultValue<string>(
    await window.desk.attachments.readText({
      knowledgeBaseId: context.knowledgeBaseId,
      noteUuid: context.noteUuid,
      path: reference
    })
  )
}

function installCodeGroups(root: HTMLElement, context: MarkdownRenderContext): () => void {
  const controller = new AbortController()
  const groups = [
    ...(root.matches('.tn-code-group') ? [root] : []),
    ...root.querySelectorAll<HTMLElement>('.tn-code-group')
  ]
  for (const group of groups) {
    group.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-code-tab]')
        if (!button) return
        event.stopPropagation()
        const index = button.dataset.codeTab
        group
          .querySelectorAll('[data-code-tab]')
          .forEach((item) => item.classList.toggle('active', item === button))
        group
          .querySelectorAll<HTMLElement>('[data-code-panel]')
          .forEach((panel) => panel.classList.toggle('active', panel.dataset.codePanel === index))
      },
      { signal: controller.signal }
    )
    for (const code of group.querySelectorAll<HTMLElement>('.tn-code-reference')) {
      const reference = code.dataset.reference
      if (!reference) continue
      void readReference(context, reference)
        .then((content) => {
          if (controller.signal.aborted) return
          const language = code.dataset.language ?? ''
          code.innerHTML =
            language && hljs.getLanguage(language)
              ? hljs.highlight(content, { language, ignoreIllegals: true }).value
              : content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            code.textContent = error instanceof Error ? error.message : String(error)
          }
        })
    }
  }
  return () => controller.abort()
}

function installSwipers(root: HTMLElement): () => void {
  const controller = new AbortController()
  const swipers = [
    ...(root.matches('.tn-swiper') ? [root] : []),
    ...root.querySelectorAll<HTMLElement>('.tn-swiper')
  ]
  for (const swiper of swipers) {
    const slides = [...swiper.querySelectorAll<HTMLElement>('[data-swiper-slide]')]
    let activeIndex = 0
    const render = (): void => {
      slides.forEach((slide, index) => slide.classList.toggle('active', index === activeIndex))
      const status = swiper.querySelector<HTMLElement>('[data-swiper-status]')
      if (status) status.textContent = `${activeIndex + 1} / ${slides.length}`
    }
    swiper.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          '[data-swiper-action]'
        )
        if (!button || slides.length === 0) return
        event.stopPropagation()
        activeIndex =
          button.dataset.swiperAction === 'previous'
            ? (activeIndex - 1 + slides.length) % slides.length
            : (activeIndex + 1) % slides.length
        render()
      },
      { signal: controller.signal }
    )
    render()
  }
  return () => controller.abort()
}

async function mountMindmap(
  root: HTMLElement,
  block: VisualBlock,
  context: MarkdownRenderContext
): Promise<() => void> {
  const { CanvasViewer, MindmapSession } = await import('@tnotesjs/mindmap-core')
  const embeddedHost = root.matches('[data-mindmap-content]')
    ? root
    : root.querySelector<HTMLElement>('[data-mindmap-content]')
  const fence = fenceParts(block.source)
  const info = fence.info
  let embeddedContent = embeddedHost?.dataset.mindmapContent
  if (embeddedContent) {
    try {
      embeddedContent = decodeURIComponent(embeddedContent)
    } catch {
      // Keep an explicitly supplied unencoded value.
    }
  }
  const initialContent = embeddedContent ?? fence.content
  const infoTitle = info.match(/\[([^\]]+)\]/)?.[1]
  const reference = referenceFrom(initialContent)
  const content = reference ? await readReference(context, reference.path) : initialContent
  const hasRoot = /^\s*#\s+/m.test(content)
  const title = infoTitle || reference?.title || content.match(/^\s*#\s+(.+)$/m)?.[1] || 'root'
  const markdown = hasRoot ? content : `# ${title}\n\n${content.trim()}\n`
  root.innerHTML = '<div class="tn-mindmap-canvas" aria-label="Mindmap 只读预览"></div>'
  const host = root.querySelector<HTMLElement>('.tn-mindmap-canvas')!
  const session = new MindmapSession({
    markdown,
    fileName: 'desk-mindmap-preview.tn-mindmap.md'
  })
  const theme = document.documentElement.classList.contains('light') ? 'light' : 'dark'
  const viewer = new CanvasViewer(host, session, {
    theme,
    resolveImageSrc: (src) => {
      if (/^(?:https?:|data:|tnotes-asset:)/i.test(src)) return src
      const params = new URLSearchParams({
        knowledgeBaseId: context.knowledgeBaseId,
        noteUuid: context.noteUuid,
        path: src
      })
      return `tnotes-asset://asset?${params.toString()}`
    }
  })
  const resizeObserver = new ResizeObserver(() => viewer.zoomToFit())
  resizeObserver.observe(host)
  requestAnimationFrame(() => viewer.zoomToFit())
  return () => {
    resizeObserver.disconnect()
    viewer.destroy()
  }
}

async function mountMermaid(root: HTMLElement, block: VisualBlock): Promise<void> {
  const mermaid = (await import('mermaid')).default
  const embeddedHost = root.matches('[data-mermaid-content]')
    ? root
    : root.querySelector<HTMLElement>('[data-mermaid-content]')
  const content = embeddedHost?.dataset.mermaidContent ?? fenceParts(block.source).content
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.classList.contains('light') ? 'default' : 'dark'
  })
  const id = `tn-mermaid-${crypto.randomUUID()}`
  const rendered = await mermaid.render(id, content)
  root.innerHTML = DOMPurify.sanitize(rendered.svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject']
  })
}

function flattenNotes(nodes: DeskTocNode[]): Array<Extract<DeskTocNode, { type: 'note' }>> {
  return nodes.flatMap((node) => [
    ...(node.type === 'note' ? [node] : []),
    ...flattenNotes(node.children)
  ])
}

async function mountNoteReferences(
  root: HTMLElement,
  context: MarkdownRenderContext,
  handlers: SpecialBlockHandlers
): Promise<void> {
  const host = root.matches('.tn-note-references')
    ? root
    : root.querySelector<HTMLElement>('.tn-note-references')
  if (!host) return
  const result = await window.desk.knowledgeBases.read(context.knowledgeBaseId)
  if (!result.ok) throw new Error(result.error.message)
  const byIndex = new Map(flattenNotes(result.value.toc).map((note) => [note.noteIndex, note]))
  const ids = (host.dataset.noteIds ?? '').split(',').filter(Boolean)
  host.innerHTML = ''
  for (const id of ids) {
    const note = byIndex.get(id)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'tn-note-reference'
    button.textContent = note ? `${note.noteIndex}. ${note.title}` : `${id}. 笔记不存在`
    button.disabled = !note
    if (note) button.addEventListener('click', () => handlers.openNote(note.uuid))
    host.append(button)
  }
}

export function mountSpecialBlock(
  root: HTMLElement,
  block: VisualBlock,
  context: MarkdownRenderContext,
  handlers: SpecialBlockHandlers
): () => void {
  const cleanups = [installCodeGroups(root, context), installSwipers(root)]
  let disposed = false
  let asyncCleanup: (() => void) | undefined
  const reportError = (error: unknown): void => {
    if (disposed) return
    root.innerHTML = `<div class="tn-special-error"></div>`
    root.querySelector<HTMLElement>('.tn-special-error')!.textContent =
      error instanceof Error ? error.message : String(error)
  }

  const hasMindmap = block.kind === 'mindmap' || Boolean(root.querySelector('.tn-mindmap'))
  const hasMermaid = block.kind === 'mermaid' || Boolean(root.querySelector('.tn-mermaid'))

  if (hasMindmap) {
    void mountMindmap(root, block, context)
      .then((cleanup) => {
        if (disposed) cleanup()
        else asyncCleanup = cleanup
      })
      .catch(reportError)
  } else if (hasMermaid) {
    void mountMermaid(root, block).catch(reportError)
  } else if (block.kind === 'component') {
    void mountNoteReferences(root, context, handlers).catch(reportError)
  }

  return () => {
    disposed = true
    cleanups.forEach((cleanup) => cleanup())
    asyncCleanup?.()
  }
}
