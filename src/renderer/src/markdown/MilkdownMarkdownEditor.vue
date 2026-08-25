<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { Plugin } from '@milkdown/kit/prose/state'
import {
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
  imageSchema
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { $prose, $view, callCommand, insert, insertPos, replaceAll } from '@milkdown/kit/utils'
import GithubSlugger from 'github-slugger'

import {
  projectRawBlocksForMilkdown,
  rawBlockProjectionPlugins
} from '../editor/markdown/rawBlockProjection'
import { reconcileMarkdownSource } from '../editor/markdown/sourcePreservation'
import { resolveMarkdownImageUrl } from './markdownAssetUrl'

import type { NoteViewMode } from '../../../shared/contracts'

const props = defineProps<{
  content: string
  mode: NoteViewMode
  readOnly: boolean
  knowledgeBaseId: string
  noteUuid: string
  active: boolean
  uploadImage: (file: File) => Promise<{ src: string; alt: string }>
}>()

const emit = defineEmits<{
  change: [content: string]
  openLink: [url: string]
  openNote: [noteUuid: string]
  fatal: [message: string]
}>()

const host = ref<HTMLElement | null>(null)
let crepe: Crepe | null = null
let destroyed = false
let ready = false
let synchronizing = false
let originalSource = props.content
let baselineCanonical = ''
let lastEmitted: string | null = null
let contentSyncQueued = false

function isEffectivelyReadOnly(): boolean {
  return props.readOnly || props.mode === 'readonly'
}

function run(action: (editor: Crepe) => void): boolean {
  if (!crepe || !ready || isEffectivelyReadOnly()) return false
  action(crepe)
  focus()
  return true
}

function command(commandKey: { key: unknown }, payload?: unknown): boolean {
  return run((editor) => {
    editor.editor.action(callCommand(commandKey.key as never, payload as never))
  })
}

function insertTextAt(text: string, position?: number): void {
  run((editor) => {
    if (typeof position === 'number' && position >= 0) {
      editor.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const safePosition = Math.min(position, view.state.doc.content.size)
        insertPos(text, safePosition, true)(ctx)
      })
      return
    }
    editor.editor.action(insert(text))
  })
}

function wrapSelection(prefix: string, suffix: string, placeholder = '文字'): void {
  const marker = `${prefix}\u0000${suffix}`
  if (marker === '**\u0000**') {
    command(toggleStrongCommand)
    return
  }
  if (marker === '*\u0000*') {
    command(toggleEmphasisCommand)
    return
  }
  if (marker === '`\u0000`') {
    command(toggleInlineCodeCommand)
    return
  }
  if (marker === '~~\u0000~~') {
    command(toggleStrikethroughCommand)
    return
  }
  if (prefix === '[' && suffix.startsWith('](')) {
    const hasSelection = crepe?.editor.action(
      (ctx) => !ctx.get(editorViewCtx).state.selection.empty
    )
    if (!hasSelection) {
      insertTextAt(`${prefix}${placeholder}${suffix}`)
      return
    }
    command(toggleLinkCommand, { href: 'https://', title: '' })
    return
  }
  insertTextAt(`${prefix}${placeholder}${suffix}`)
}

function prefixSelection(prefix: string): void {
  if (prefix.trim() === '>') command(wrapInBlockquoteCommand)
  else insertTextAt(prefix)
}

function setLinePrefix(prefix: string): void {
  const heading = prefix.match(/^(#{1,6})\s$/)
  if (heading) {
    command(wrapInHeadingCommand, heading[1].length)
    return
  }
  if (!prefix) {
    command(turnIntoTextCommand)
    return
  }
  if (prefix === '> ') {
    command(wrapInBlockquoteCommand)
    return
  }
  if (prefix === '- ') {
    command(wrapInBulletListCommand)
    return
  }
  if (prefix === '1. ') {
    command(wrapInOrderedListCommand)
    return
  }
  insertTextAt(prefix)
}

function insertCodeBlock(language = 'ts'): void {
  command(createCodeBlockCommand, language)
}

function insertTable(): void {
  command(insertTableCommand, { row: 3, col: 3 })
}

function focus(): void {
  if (!crepe || !ready) return
  crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
}

defineExpose({
  insertTextAt,
  wrapSelection,
  prefixSelection,
  setLinePrefix,
  insertCodeBlock,
  insertTable,
  focus
})

const githubSlugger = new GithubSlugger()

function headingElementText(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+#+\s*$/, '').trim()
}

function resolveHeadingTarget(targetId: string): HTMLElement | null {
  const root = host.value
  if (!root) return null

  // Milkdown assigns heading ids with a rule that diverges from the TOC anchors
  // (e.g. `1. 本节内容` -> `1.-本节内容` versus the canonical `1-本节内容`).
  // Prefer an exact id match, then fall back to a fresh canonical slug match.
  const byExplicitId = [...root.querySelectorAll<HTMLElement>('[id]')].find(
    (element) => element.id === targetId
  )
  if (byExplicitId) return byExplicitId

  let fallback: HTMLElement | null = null
  for (const element of [...root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')]) {
    if (githubSlugger.slug(headingElementText(element)) === targetId) {
      fallback = element
      break
    }
  }
  return fallback
}

function handleClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return
  const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
  if (!anchor) return
  const href = anchor.getAttribute('href') ?? ''
  if (href.startsWith('#')) {
    event.preventDefault()
    let targetId = href.slice(1)
    try {
      targetId = decodeURIComponent(targetId)
    } catch {
      // Keep malformed hashes comparable to the literal heading id.
    }
    const target = resolveHeadingTarget(targetId)
    target?.scrollIntoView({ block: 'start' })
    return
  }
  if (!isEffectivelyReadOnly() && !event.metaKey && !event.ctrlKey) return
  event.preventDefault()
  emit('openLink', href)
}

function flushCurrentContent(editor = crepe): void {
  if (!editor || !ready || synchronizing || destroyed) return
  const markdown = editor.getMarkdown()
  const preserved = reconcileMarkdownSource(originalSource, baselineCanonical, markdown)
  if (preserved === props.content || preserved === lastEmitted) return
  lastEmitted = preserved
  emit('change', preserved)
}

function queueCurrentContentSync(): void {
  if (contentSyncQueued) return
  contentSyncQueued = true
  queueMicrotask(() => {
    contentSyncQueued = false
    flushCurrentContent()
  })
}

async function syncExternalContent(content: string): Promise<void> {
  if (!crepe || !ready) return
  synchronizing = true
  originalSource = content
  lastEmitted = null
  try {
    crepe.editor.action(replaceAll(projectRawBlocksForMilkdown(content), true))
    baselineCanonical = crepe.getMarkdown()
  } finally {
    synchronizing = false
  }
}

onMounted(async () => {
  if (!host.value) return
  originalSource = props.content
  const editor = new Crepe({
    root: host.value,
    defaultValue: projectRawBlocksForMilkdown(props.content),
    features: {
      [Crepe.Feature.ImageBlock]: false
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: '输入 / 插入内容',
        mode: 'block'
      }
    }
  })
  editor.editor.use(rawBlockProjectionPlugins)
  editor.editor.use(
    $view(imageSchema.node, () => (node) => {
      const dom = document.createElement('img')
      let currentNode = node

      const render = (): void => {
        const source = String(currentNode.attrs.src ?? '')
        const presentationUrl = resolveMarkdownImageUrl(
          source,
          props.knowledgeBaseId,
          props.noteUuid
        )
        if (presentationUrl) dom.setAttribute('src', presentationUrl)
        else dom.removeAttribute('src')
        dom.classList.toggle('is-unavailable', !presentationUrl)
        dom.setAttribute('alt', String(currentNode.attrs.alt ?? ''))
        const title = String(currentNode.attrs.title ?? '')
        if (title) dom.setAttribute('title', title)
        else dom.removeAttribute('title')
        dom.draggable = true
      }

      render()
      return {
        dom,
        update: (nextNode) => {
          if (nextNode.type !== currentNode.type) return false
          currentNode = nextNode
          render()
          return true
        },
        selectNode: () => dom.classList.add('ProseMirror-selectednode'),
        deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
        ignoreMutation: () => true
      }
    })
  )
  editor.editor.use(
    $prose(
      () =>
        new Plugin({
          view: () => ({
            update: (view, previousState) => {
              if (!view.state.doc.eq(previousState.doc)) queueCurrentContentSync()
            }
          })
        })
    )
  )
  editor.editor.config((ctx) => {
    ctx.update(uploadConfig.key, (current) => ({
      ...current,
      enableHtmlFileUploader: true,
      // Milkdown's upload plugin keeps a mapped placeholder in the document,
      // so edits made while the image uploads cannot stale the insertion point.
      uploader: async (files, schema) => {
        const imageType = schema.nodes.image
        if (!imageType) return []
        const images = [...files].filter((file) => file.type.startsWith('image/'))
        return Promise.all(
          images.map(async (file) => {
            const uploaded = await props.uploadImage(file)
            return imageType.create({ src: uploaded.src, alt: uploaded.alt })
          })
        )
      }
    }))
  })
  editor.setReadonly(isEffectivelyReadOnly())
  crepe = editor
  try {
    await editor.create()
    if (destroyed) {
      await editor.destroy()
      return
    }
    baselineCanonical = editor.getMarkdown()
    ready = true
    if (props.content !== originalSource) await syncExternalContent(props.content)
    if (props.active) focus()
  } catch (cause) {
    try {
      await editor.destroy()
    } catch {
      // A partially-created editor may not have every cleanup timer available.
    }
    if (crepe === editor) crepe = null
    emit('fatal', cause instanceof Error ? cause.message : String(cause))
  }
})

watch(
  () => props.content,
  (content) => {
    if (!ready || !crepe) return
    if (content === lastEmitted) {
      lastEmitted = null
      return
    }
    void syncExternalContent(content)
  }
)

watch(
  () => [props.mode, props.readOnly] as const,
  () => crepe?.setReadonly(isEffectivelyReadOnly())
)

watch(
  () => props.active,
  (active) => {
    if (active) focus()
  }
)

onBeforeUnmount(() => {
  flushCurrentContent()
  destroyed = true
  ready = false
  const editor = crepe
  crepe = null
  if (editor) void editor.destroy()
})
</script>

<template>
  <div ref="host" class="milkdown-markdown-editor" @click.capture="handleClick" />
</template>

<style scoped>
.milkdown-markdown-editor {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--editor-bg);
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown) {
  min-height: 100%;
  color: var(--editor-text);
  --crepe-base-font-size: 15px;
  --crepe-font-default: var(--font-sans);
  --crepe-font-code: var(--font-mono);
  --crepe-color-background: var(--editor-bg);
  --crepe-color-on-background: var(--editor-text);
  --crepe-color-surface: var(--panel);
  --crepe-color-surface-low: var(--hover);
  --crepe-color-on-surface: var(--editor-text);
  --crepe-color-on-surface-variant: var(--muted);
  --crepe-color-outline: var(--border);
  --crepe-color-primary: var(--accent-strong);
  --crepe-color-secondary: var(--accent);
  --crepe-color-on-secondary: var(--editor-text);
  --crepe-color-inverse: var(--editor-text);
  --crepe-color-on-inverse: var(--editor-bg);
  --crepe-color-inline-code: var(--danger);
  --crepe-color-error: var(--danger);
  --crepe-color-hover: var(--hover);
  --crepe-color-selected: color-mix(in srgb, var(--accent) 45%, transparent);
  --crepe-color-inline-area: var(--border);
}

.milkdown-markdown-editor :deep(.ProseMirror) {
  box-sizing: border-box;
  width: min(100%, 940px);
  min-height: 100%;
  margin: 0 auto;
  padding: 28px 40px 48px;
  line-height: 1.72;
  outline: none;
}

.milkdown-markdown-editor :deep(.ProseMirror > :first-child) {
  margin-top: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block) {
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  min-height: 38px;
  margin: 12px 0;
  padding: 8px 11px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
  color: var(--muted);
  cursor: default;
  user-select: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block.ProseMirror-selectednode) {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 1px var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block--hidden) {
  display: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block__label) {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block__preview) {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.milkdown-markdown-editor :deep(.desk-generated-title) {
  margin: 0 0 1.25em;
  padding: 0;
  border: 0;
  font-size: 1.75em;
  font-weight: 700;
  line-height: 1.3;
  color: var(--editor-text);
  cursor: default;
}

.milkdown-markdown-editor :deep(.desk-generated-title a) {
  color: inherit;
  text-decoration: none;
}

.milkdown-markdown-editor :deep(.desk-generated-title.ProseMirror-selectednode) {
  outline: 2px solid var(--accent-strong);
  outline-offset: 4px;
}

.milkdown-markdown-editor :deep(.desk-generated-toc) {
  margin: 0.5em 0 1.25em;
  padding: 0;
}

.milkdown-markdown-editor :deep(.desk-generated-toc__toggle) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 2px 4px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.milkdown-markdown-editor :deep(.desk-generated-toc__toggle:hover) {
  color: var(--text);
}

.milkdown-markdown-editor :deep(.desk-generated-toc__toggle-icon) {
  width: 0;
  height: 0;
  border-left: 5px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 120ms ease;
}

.milkdown-markdown-editor :deep(.desk-generated-toc.is-collapsed .desk-generated-toc__toggle-icon) {
  transform: rotate(90deg);
}

.milkdown-markdown-editor :deep(.desk-generated-toc__list) {
  margin: 0;
  padding-left: 1.4em;
}

.milkdown-markdown-editor :deep(.desk-generated-toc.is-collapsed .desk-generated-toc__list) {
  display: none;
}

.milkdown-markdown-editor :deep(.desk-generated-toc__list ul) {
  padding-left: 1.4em;
}

.milkdown-markdown-editor :deep(.desk-generated-toc__list li) {
  margin: 0.15em 0;
}

.milkdown-markdown-editor :deep(.desk-generated-toc__link) {
  color: var(--accent-strong);
  text-decoration: none;
}

.milkdown-markdown-editor :deep(.desk-generated-toc__link:hover) {
  text-decoration: underline;
}

.milkdown-markdown-editor :deep(.desk-generated-toc.ProseMirror-selectednode) {
  outline: 2px solid var(--accent-strong);
  outline-offset: 2px;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .language-picker) {
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .language-picker .list-wrapper) {
  background: var(--panel);
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .language-list-item) {
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .language-list-item:hover) {
  background: var(--hover);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .search-box input) {
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .tools-button-group button) {
  background: var(--panel);
  color: var(--editor-text);
  border: 1px solid var(--border);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .tools-button-group button:hover) {
  background: var(--hover);
  color: var(--text);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .tools-button-group button svg) {
  fill: currentColor;
  color: currentColor;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .cm-editor) {
  background: var(--editor-bg);
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown-code-block) {
  background: var(--editor-bg);
  border: 1px solid transparent;
  border-radius: 8px;
  transition: border-color 120ms ease;
}

.milkdown-markdown-editor :deep(.milkdown-code-block:hover) {
  border-color: var(--border);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .cm-gutters) {
  background: var(--editor-bg);
  color: var(--muted);
  border-right: 1px solid var(--border);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .language-button) {
  opacity: 1;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .cm-activeLine) {
  background: transparent;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .cm-editor:focus-within .cm-activeLine) {
  background: color-mix(in srgb, var(--hover) 62%, transparent);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .cm-activeLineGutter) {
  background: transparent;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .cm-editor:focus-within .cm-activeLineGutter) {
  background: color-mix(in srgb, var(--hover) 62%, transparent);
  color: var(--muted);
}

@media (max-width: 720px) {
  .milkdown-markdown-editor :deep(.ProseMirror) {
    padding: 22px 20px 40px;
  }
}
</style>
