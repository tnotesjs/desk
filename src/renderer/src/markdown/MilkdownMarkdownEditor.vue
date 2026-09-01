<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, commandsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { Plugin, TextSelection, NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { buildTNotesSlashGroup, installSlashMenuPresentation } from './slashMenu'
import type { SlashMenuItem } from './slashMenu'
import {
  createBlockShortcutPlugin,
  createMarkdownShortcutInputRules,
  replaceCurrentParagraphWithItem
} from './markdownInputRules'
import {
  attachRawBlockBoundaryControls,
  clearRawBlockSelectionState,
  createRawBlockSelectionPlugin
} from './rawBlockInteractions'
import { createReadonlyTransactionGuard } from './readonlyGuard'
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
  clearTextInCurrentBlockCommand,
  imageSchema
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { $prose, $view, callCommand, insert, insertPos, replaceAll } from '@milkdown/kit/utils'
import GithubSlugger from 'github-slugger'

import BlockActionMenu from './BlockActionMenu.vue'
import type { BlockAction } from './BlockActionMenu.vue'
import { installBlockHandleClickController, type BlockHandleClickTarget } from './blockActionMenu'
import { createCodeBlockTitlePlugin } from './codeBlockTitlePlugin'

import {
  projectRawBlocksForMilkdown,
  rawBlockProjectionPlugins,
  rawBlockSchema as deskRawBlockSchema,
  renderDeskRawBlockElement
} from '../editor/markdown/rawBlockProjection'
import type { ProjectedRawBlockKind } from '../editor/markdown/rawBlockProjection'
import {
  isStructuredCalloutSource,
  parseContainerSource,
  rebuildContainerSource,
  renderContainerFromSource
} from '../editor/markdown/containerBody'
import {
  createContainerSourceEditor,
  type ContainerSourceEditorHandle
} from '../editor/markdown/containerSourceEditor'
import { deleteDeskRawBlockAt } from '../editor/markdown/rawBlockEmpty'
import { renderDiagram, parseFencedCode, rebuildMermaidFence } from '../editor/markdown/diagramRenderer'
import { mindmapPreviewMarkdown, rebuildMindmapFence } from '../editor/markdown/mindmapFence'
import {
  bodyHasIncludeLines,
  codeGroupEntryTabTitle,
  includeLanguage,
  parseCodeGroupEntries,
  parseDeskIncludeLine,
  serializeCodeGroupEntries,
  withCodeGroupEntryLanguage,
  withCodeGroupEntryTitle,
  type CodeGroupEntry
} from '../editor/markdown/deskInclude'
import {
  applySwiperTabsPadding,
  createSwiperTabNav,
  parseSwiperSlides,
  serializeSwiperSlides,
  swiperSlideTabTitle,
  withSwiperSlideTitle,
  wrapSlideIndex,
  type SwiperSlideEntry
} from '../editor/markdown/swiperSlides'
import { mountCodeTabEditor, type CodeTabEditorHandle } from '../editor/markdown/deskCodeTabEditor'
import { reconcileMarkdownSource } from '../editor/markdown/sourcePreservation'
import { resolveMarkdownImageUrl } from './markdownAssetUrl'
import {
  isBilibiliVideoSource,
  isWordListSource,
  isNotesTableSource,
  parseBilibiliVideoSource,
  parseWordListSource,
  parseNotesTableSource,
  rebuildBilibiliVideoSource,
  rebuildWordListSource,
  rebuildNotesTableSource
} from '../editor/markdown/componentBody'
import {
  mountBilibiliVideoPreview,
  mountMermaidPreview,
  mountMindmapPreview,
  mountNotesTablePreview,
  mountFootprintsPreview,
  mountWordListPreview
} from '../editor/markdown/componentPreview'
import { parseFootprintsSource, type FootprintsPayload } from '@tnotesjs/ui'

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
let slashMenuPresentationCleanup: (() => void) | null = null
let blockHandleClickCleanup: (() => void) | null = null
const rawSourceReadonlyListeners = new Set<(readOnly: boolean) => void>()

interface BlockActionMenuState extends BlockHandleClickTarget {
  x: number
  y: number
}

const blockActionMenu = ref<BlockActionMenuState | null>(null)
let addBelowMenuOpened = false

function isEffectivelyReadOnly(): boolean {
  return props.readOnly || props.mode === 'readonly'
}

function editorView(): EditorView | null {
  return crepe?.editor.action((ctx) => ctx.get(editorViewCtx)) ?? null
}

function positionBlockActionMenu(target: BlockHandleClickTarget): BlockActionMenuState {
  const width = 224
  const estimatedHeight = 176
  const gap = 6
  const x = Math.max(8, Math.min(target.handleRect.left, window.innerWidth - width - 8))
  const below = target.handleRect.bottom + gap
  const y =
    below + estimatedHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, target.handleRect.top - estimatedHeight - gap)
  return {
    ...target,
    x,
    y
  }
}

function openBlockActionMenu(target: BlockHandleClickTarget): void {
  if (isEffectivelyReadOnly()) return
  addBelowMenuOpened = false
  blockActionMenu.value = positionBlockActionMenu(target)
}

function closeBlockActionMenu(focusEditor = true): void {
  if (!blockActionMenu.value) return
  blockActionMenu.value = null
  addBelowMenuOpened = false
  if (focusEditor) editorView()?.focus()
}

function currentBlockTarget(): { view: EditorView; position: number; dom: HTMLElement } | null {
  const menu = blockActionMenu.value
  const view = editorView()
  if (!menu || !view || !menu.dom.isConnected) return null
  let position = menu.position
  if (view.nodeDOM(position) !== menu.dom) {
    position = -1
    view.state.doc.descendants((node, candidate) => {
      if (position >= 0 || node.type.name !== 'deskRawBlock') return
      if (view.nodeDOM(candidate) === menu.dom) position = candidate
    })
  }
  if (position < 0 || view.state.doc.nodeAt(position)?.type.name !== 'deskRawBlock') return null
  return { view, position, dom: menu.dom }
}

function deleteCurrentBlock(): void {
  if (isEffectivelyReadOnly()) return closeBlockActionMenu(false)
  const target = currentBlockTarget()
  if (!target) return closeBlockActionMenu()
  const node = target.view.state.doc.nodeAt(target.position)
  if (!node) return
  const transaction = target.view.state.tr.delete(target.position, target.position + node.nodeSize)
  transaction.setSelection(
    TextSelection.near(
      transaction.doc.resolve(Math.min(target.position, transaction.doc.content.size)),
      -1
    )
  )
  target.view.dispatch(transaction.scrollIntoView())
  closeBlockActionMenu()
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Electron can expose Clipboard without granting the renderer's async
      // Clipboard permission. Fall through to the synchronous user-gesture
      // path so the menu action still works.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

/** CodeMirror splits lines into `.cm-line` divs; parent textContent drops newlines. */
function readCodeBlockPlainText(block: Element): string {
  const lines = block.querySelectorAll('.cm-line')
  if (lines.length > 0) {
    return Array.from(lines, (line) => line.textContent ?? '').join('\n')
  }
  return block.querySelector('pre, code')?.textContent ?? ''
}

async function copyCurrentBlock(): Promise<boolean> {
  const target = currentBlockTarget()
  const node = target?.view.state.doc.nodeAt(target.position)
  if (!target || !node) return false
  await writeClipboard(String(node.attrs.source ?? ''))
  return true
}

function openAddBelowMenu(): void {
  if (isEffectivelyReadOnly() || addBelowMenuOpened || !blockActionMenu.value || !host.value) return
  const addButton = host.value.querySelector<HTMLElement>(
    '.milkdown-block-handle[data-show="true"] .operation-item:first-child'
  )
  if (!addButton) return
  addBelowMenuOpened = true
  addButton.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }))
}

async function handleBlockAction(action: BlockAction): Promise<void> {
  if (isEffectivelyReadOnly()) return closeBlockActionMenu(false)
  if (action === 'delete') return deleteCurrentBlock()
  if (action === 'copy') {
    await copyCurrentBlock()
    return closeBlockActionMenu()
  }
  if (action === 'cut') {
    if (await copyCurrentBlock()) deleteCurrentBlock()
    return
  }
  if (action === 'add-below') openAddBelowMenu()
}

function handleBlockMenuOutsidePointer(event: PointerEvent): void {
  if (!blockActionMenu.value) return
  const target = event.target as Element | null
  if (target?.closest('.desk-block-action-menu, .milkdown-block-handle, .milkdown-slash-menu'))
    return
  closeBlockActionMenu(false)
}

function handleBlockMenuDocumentPointerUp(event: PointerEvent): void {
  const target = event.target as Element | null
  if (target?.closest('.milkdown-slash-menu li[data-index]')) {
    closeBlockActionMenu(false)
  }
}

interface RawSourceEditorContext {
  dom: HTMLElement
  source: string
  view: EditorView
  getPos: () => number | undefined
  label: string
  /** Structured callouts edit title+body only; fences stay locked. */
  structuredCallout?: boolean
  /** BilibiliVideo: edit BV id only; rebuild canonical full tag. */
  structuredBilibili?: boolean
  /** WordList: edit words + needSort; rebuild canonical full tag. */
  structuredWordList?: boolean
  /** Mermaid: edit diagram body only; fence + center stay locked (center via toggle). */
  structuredMermaid?: boolean
  /** Mindmap: edit diagram body only; fence locked. */
  structuredMindmap?: boolean
  /** NotesTable: edit ids list; rebuild tag. */
  structuredNotesTable?: boolean
  /** code-group / swiper: edit body only; container fences locked. */
  structuredContainerBody?: boolean
  /** Use the shared icon+Edit pill chrome without enabling a structured form. */
  editPill?: boolean
  /** Live atom source when writebacks update the node without remounting. */
  getSource?: () => string
  renderPreview: (source: string) => void
}

/**
 * Wires the edit button + inline editor onto an editable raw block. Structured
 * callouts (tip/info/…) expose title + body only; other blocks still edit the
 * full source. Commits update the atom source and are reconciled by
 * sourcePreservation.
 */
const EDIT_PILL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.06 9.02 14.98 9.94 5.92 19H5v-.92l9.06-9.06ZM17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41L18.37 3.29c-.2-.2-.45-.29-.71-.29ZM14.06 6.19 3 17.25V21h3.75L17.81 9.94 14.06 6.19Z"/></svg>`
const DONE_PILL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.55 18.2 3.65 12.3l1.4-1.4 4.5 4.5L18.95 5.95l1.4 1.4z"/></svg>`

function attachRawSourceEditor(ctx: RawSourceEditorContext): () => void {
  const liveSource = (): string => ctx.getSource?.() ?? ctx.source
  const structured = Boolean(
    ctx.structuredCallout ||
      ctx.structuredBilibili ||
      ctx.structuredWordList ||
      ctx.structuredMermaid ||
      ctx.structuredMindmap ||
      ctx.structuredNotesTable ||
      ctx.structuredContainerBody
  )
  const useEditPill = structured || Boolean(ctx.editPill)
  const editButton = document.createElement('button')
  editButton.type = 'button'
  editButton.className = useEditPill
    ? 'desk-raw-block__edit desk-raw-block__edit--pill'
    : 'desk-raw-block__edit'
  if (useEditPill) {
    editButton.innerHTML = `${EDIT_PILL_ICON}<span>Edit</span>`
    editButton.setAttribute('aria-label', 'Edit')
    editButton.title = 'Edit'
  } else {
    editButton.textContent = '编辑源码'
  }
  const editorHost = document.createElement('div')
  editorHost.className = structured
    ? 'desk-raw-block__editor desk-raw-block__editor--structured'
    : 'desk-raw-block__editor'
  editorHost.hidden = true
  ctx.dom.append(editButton, editorHost)

  let editorValue = liveSource()
  let draftTitle = ''
  let draftBody = ''
  let draftMermaidBody = ''
  let draftMindmapBody = ''
  let draftNotesTableIds = ''
  let draftContainerBody = ''
  let draftBilibiliId = ''
  let draftBilibiliAutoplay = false
  let draftBilibiliMuted = false
  let draftWordListText = ''
  let draftWordListNeedSort = false
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let blurCommitTimer: ReturnType<typeof setTimeout> | null = null
  let editing = false
  let editorHandle: ContainerSourceEditorHandle | null = null

  const fitEditorToSource = (value: string): void => {
    const lines = value.split(/\r?\n/).length
    const height = Math.min(320, Math.max(132, lines * 22 + 56))
    editorHost.style.setProperty('--desk-raw-editor-height', `${height}px`)
  }

  const clearBlurCommit = (): void => {
    if (blurCommitTimer != null) {
      clearTimeout(blurCommitTimer)
      blurCommitTimer = null
    }
  }

  const closeEditing = (): void => {
    clearBlurCommit()
    if (syncTimer != null) {
      clearTimeout(syncTimer)
      syncTimer = null
    }
    editing = false
    editorHandle?.destroy()
    editorHandle = null
    editorHost.hidden = true
    editButton.hidden = false
    editButton.disabled = false
  }

  const applyReadonly = (readOnly: boolean): void => {
    if (readOnly) {
      if (syncTimer != null) {
        clearTimeout(syncTimer)
        syncTimer = null
      }
      if (editing) ctx.renderPreview(liveSource())
      closeEditing()
      editButton.hidden = true
      editButton.disabled = true
      return
    }
    if (!editing) {
      editButton.hidden = false
      editButton.disabled = false
    }
  }

  const commit = (): void => {
    if (!editing) return
    if (isEffectivelyReadOnly()) {
      applyReadonly(true)
      return
    }
    if (editorValue === liveSource()) {
      setTimeout(closeEditing, 0)
      return
    }
    const position = ctx.getPos()
    if (position == null) return
    const currentNode = ctx.view.state.doc.nodeAt(position)
    if (currentNode?.type.name !== 'deskRawBlock') return
    ctx.view.dispatch(
      ctx.view.state.tr.setNodeMarkup(position, undefined, {
        ...(currentNode.attrs as Record<string, unknown>),
        source: editorValue
      })
    )
    setTimeout(closeEditing, 0)
  }

  /** Empty source + Backspace at doc start → delete the atom (Crepe code-block UX). */
  const removeBlockOnEmptyBackspace = (): boolean => {
    if (isEffectivelyReadOnly()) return false
    const position = ctx.getPos()
    if (position == null) return false
    if (syncTimer != null) {
      clearTimeout(syncTimer)
      syncTimer = null
    }
    clearBlurCommit()
    const handle = editorHandle
    editorHandle = null
    editing = false
    handle?.destroy()
    return deleteDeskRawBlockAt(ctx.view, position)
  }

  const publishDraft = (): void => {
    if (isEffectivelyReadOnly()) return
    if (ctx.structuredBilibili) {
      const parsed = parseBilibiliVideoSource(liveSource())
      editorValue = rebuildBilibiliVideoSource({
        id: draftBilibiliId,
        autoplay: draftBilibiliAutoplay,
        muted: draftBilibiliMuted,
        trailingNewline: parsed?.trailingNewline ?? true
      })
    } else if (ctx.structuredWordList) {
      const parsed = parseWordListSource(liveSource())
      const words = draftWordListText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      editorValue = rebuildWordListSource({
        words,
        needSort: draftWordListNeedSort,
        trailingNewline: parsed?.trailingNewline ?? true
      })
    } else if (ctx.structuredMermaid) {
      const center = parseFencedCode(editorValue).center
      editorValue = rebuildMermaidFence(liveSource(), center, draftMermaidBody)
    } else if (ctx.structuredMindmap) {
      const fence = parseFencedCode(liveSource())
      const trailingNewline = /\r?\n$/.test(liveSource())
      const open = fence.title
        ? `\`\`\`mindmap [${fence.title}]`
        : '```mindmap'
      const core = `${open}\n${draftMindmapBody.replace(/\n$/, '')}\n\`\`\``
      editorValue = trailingNewline ? `${core}\n` : core
    } else if (ctx.structuredNotesTable) {
      const ids = draftNotesTableIds
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      editorValue = rebuildNotesTableSource({
        ids,
        trailingNewline: parseNotesTableSource(liveSource())?.trailingNewline ?? true
      })
    } else if (ctx.structuredContainerBody) {
      const parsed = parseContainerSource(liveSource())
      editorValue = rebuildContainerSource(liveSource(), {
        title: parsed.title,
        body: draftContainerBody,
        name: parsed.name
      })
    } else {
      editorValue = rebuildContainerSource(liveSource(), {
        title: draftTitle,
        body: draftBody,
        name: parseContainerSource(liveSource()).name
      })
    }
    fitEditorToSource(editorValue)
    if (syncTimer != null) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      ctx.renderPreview(editorValue)
      expandDetailsPreview()
    }, 250)
  }

  /** Details stays open while the structured editor is active. */
  const expandDetailsPreview = (): void => {
    const details = ctx.dom.querySelector(
      'details.custom-block-details'
    ) as HTMLDetailsElement | null
    if (details) details.open = true
  }

  /** Structured callouts: leaving the editor chrome auto-commits (Done). */
  const scheduleCommitOnBlur = (event: FocusEvent): void => {
    if (!structured || !editing) return
    const next = event.relatedTarget
    if (next instanceof Node && editorHost.contains(next)) return
    clearBlurCommit()
    const leftForSure = next instanceof Node && !editorHost.contains(next)
    blurCommitTimer = setTimeout(() => {
      blurCommitTimer = null
      if (!editing) return
      if (!leftForSure) {
        const active = document.activeElement
        if (active instanceof Node && editorHost.contains(active)) return
      }
      commit()
    }, 0)
  }

  if (structured) {
    editorHost.addEventListener('focusout', scheduleCommitOnBlur)
  }

  const startEditing = (): void => {
    if (editing || isEffectivelyReadOnly()) return
    editing = true
    editorValue = liveSource()
    editButton.hidden = true
    editButton.disabled = true
    expandDetailsPreview()

    editorHost.replaceChildren()

    if (ctx.structuredBilibili) {
      const parsed = parseBilibiliVideoSource(liveSource())
      draftBilibiliId = parsed?.id ?? ''
      draftBilibiliAutoplay = parsed?.autoplay ?? false
      draftBilibiliMuted = parsed?.muted ?? false
      fitEditorToSource(editorValue)

      const done = document.createElement('button')
      done.type = 'button'
      done.className = 'desk-raw-block__edit desk-raw-block__edit--pill desk-raw-block__editor-done'
      done.innerHTML = `${DONE_PILL_ICON}<span>Done</span>`
      done.setAttribute('aria-label', 'Done')
      done.title = 'Done'
      done.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        commit()
      })

      const fields = document.createElement('div')
      fields.className = 'desk-raw-block__editor-fields'

      const idInput = document.createElement('input')
      idInput.type = 'text'
      idInput.className = 'desk-raw-block__editor-title'
      idInput.value = draftBilibiliId
      idInput.placeholder = 'BVID，例如 BV1QR4y1y7GG'
      idInput.spellcheck = false
      idInput.addEventListener('input', () => {
        draftBilibiliId = idInput.value.trim()
        publishDraft()
      })
      idInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
        if (
          event.key === 'Backspace' &&
          draftBilibiliId === '' &&
          idInput.selectionStart === 0 &&
          idInput.selectionEnd === 0
        ) {
          event.preventDefault()
          removeBlockOnEmptyBackspace()
        }
      })

      const toggles = document.createElement('div')
      toggles.className = 'desk-raw-block__editor-toggles'

      const autoplayLabel = document.createElement('label')
      autoplayLabel.className = 'desk-raw-block__editor-toggle'
      const autoplayInput = document.createElement('input')
      autoplayInput.type = 'checkbox'
      autoplayInput.checked = draftBilibiliAutoplay
      autoplayInput.addEventListener('change', () => {
        draftBilibiliAutoplay = autoplayInput.checked
        publishDraft()
      })
      autoplayLabel.append(autoplayInput, document.createTextNode('自动播放'))

      const mutedLabel = document.createElement('label')
      mutedLabel.className = 'desk-raw-block__editor-toggle'
      const mutedInput = document.createElement('input')
      mutedInput.type = 'checkbox'
      mutedInput.checked = draftBilibiliMuted
      mutedInput.addEventListener('change', () => {
        draftBilibiliMuted = mutedInput.checked
        publishDraft()
      })
      mutedLabel.append(mutedInput, document.createTextNode('静音'))

      toggles.append(autoplayLabel, mutedLabel)
      fields.append(idInput, toggles)
      editorHost.append(done, fields)
      editorHost.hidden = false
      window.setTimeout(() => idInput.focus(), 0)
      return
    }

    if (ctx.structuredWordList) {
      const parsed = parseWordListSource(liveSource())
      draftWordListText = (parsed?.words ?? []).join('\n')
      draftWordListNeedSort = parsed?.needSort ?? false
      fitEditorToSource(editorValue)

      const done = document.createElement('button')
      done.type = 'button'
      done.className = 'desk-raw-block__edit desk-raw-block__edit--pill desk-raw-block__editor-done'
      done.innerHTML = `${DONE_PILL_ICON}<span>Done</span>`
      done.setAttribute('aria-label', 'Done')
      done.title = 'Done'
      done.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        commit()
      })

      const fields = document.createElement('div')
      fields.className = 'desk-raw-block__editor-fields'

      const cmHost = document.createElement('div')
      cmHost.className = 'desk-raw-block__editor-cm'

      const toggles = document.createElement('div')
      toggles.className = 'desk-raw-block__editor-toggles'
      const sortLabel = document.createElement('label')
      sortLabel.className = 'desk-raw-block__editor-toggle'
      const sortInput = document.createElement('input')
      sortInput.type = 'checkbox'
      sortInput.checked = draftWordListNeedSort
      sortInput.addEventListener('change', () => {
        draftWordListNeedSort = sortInput.checked
        publishDraft()
      })
      sortLabel.append(sortInput, document.createTextNode('按字母排序'))
      toggles.append(sortLabel)

      fields.append(cmHost, toggles)
      editorHost.append(done, fields)
      editorHost.hidden = false

      editorHandle = createContainerSourceEditor(
        cmHost,
        draftWordListText,
        (value) => {
          draftWordListText = value
          publishDraft()
        },
        () => commit(),
        {
          onEmptyBackspace: removeBlockOnEmptyBackspace,
          placeholder: '每行一个单词'
        }
      )
      return
    }

    if (ctx.structuredMermaid) {
      draftMermaidBody = parseFencedCode(liveSource()).code
      fitEditorToSource(editorValue)

      const done = document.createElement('button')
      done.type = 'button'
      done.className = 'desk-raw-block__edit desk-raw-block__edit--pill desk-raw-block__editor-done'
      done.innerHTML = `${DONE_PILL_ICON}<span>Done</span>`
      done.setAttribute('aria-label', 'Done')
      done.title = 'Done'
      done.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        commit()
      })

      const fields = document.createElement('div')
      fields.className = 'desk-raw-block__editor-fields'

      const cmHost = document.createElement('div')
      cmHost.className = 'desk-raw-block__editor-cm'
      fields.append(cmHost)
      editorHost.append(done, fields)
      editorHost.hidden = false

      editorHandle = createContainerSourceEditor(
        cmHost,
        draftMermaidBody,
        (value) => {
          draftMermaidBody = value
          publishDraft()
        },
        () => commit(),
        {
          onEmptyBackspace: removeBlockOnEmptyBackspace,
          placeholder: '输入 Mermaid 图表源码…'
        }
      )
      return
    }

    if (ctx.structuredMindmap || ctx.structuredContainerBody) {
      draftMindmapBody = ctx.structuredMindmap ? parseFencedCode(liveSource()).code : ''
      draftContainerBody = ctx.structuredContainerBody
        ? parseContainerSource(liveSource()).body
        : ''
      const initial = ctx.structuredMindmap ? draftMindmapBody : draftContainerBody
      fitEditorToSource(editorValue)

      const done = document.createElement('button')
      done.type = 'button'
      done.className = 'desk-raw-block__edit desk-raw-block__edit--pill desk-raw-block__editor-done'
      done.innerHTML = `${DONE_PILL_ICON}<span>Done</span>`
      done.setAttribute('aria-label', 'Done')
      done.title = 'Done'
      done.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        commit()
      })

      const fields = document.createElement('div')
      fields.className = 'desk-raw-block__editor-fields'
      const cmHost = document.createElement('div')
      cmHost.className = 'desk-raw-block__editor-cm'
      fields.append(cmHost)
      editorHost.append(done, fields)
      editorHost.hidden = false

      editorHandle = createContainerSourceEditor(
        cmHost,
        initial,
        (value) => {
          if (ctx.structuredMindmap) draftMindmapBody = value
          else draftContainerBody = value
          publishDraft()
        },
        () => commit(),
        {
          onEmptyBackspace: removeBlockOnEmptyBackspace,
          placeholder: ctx.structuredMindmap
            ? '输入思维导图 Markdown…'
            : '编辑容器正文…'
        }
      )
      return
    }

    if (ctx.structuredNotesTable) {
      draftNotesTableIds = (parseNotesTableSource(liveSource())?.ids ?? []).join('\n')
      fitEditorToSource(editorValue)

      const done = document.createElement('button')
      done.type = 'button'
      done.className = 'desk-raw-block__edit desk-raw-block__edit--pill desk-raw-block__editor-done'
      done.innerHTML = `${DONE_PILL_ICON}<span>Done</span>`
      done.setAttribute('aria-label', 'Done')
      done.title = 'Done'
      done.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        commit()
      })

      const fields = document.createElement('div')
      fields.className = 'desk-raw-block__editor-fields'
      const cmHost = document.createElement('div')
      cmHost.className = 'desk-raw-block__editor-cm'
      fields.append(cmHost)
      editorHost.append(done, fields)
      editorHost.hidden = false

      editorHandle = createContainerSourceEditor(
        cmHost,
        draftNotesTableIds,
        (value) => {
          draftNotesTableIds = value
          publishDraft()
        },
        () => commit(),
        {
          onEmptyBackspace: removeBlockOnEmptyBackspace,
          placeholder: '每行一个笔记 ID'
        }
      )
      return
    }

    if (structured) {
      const parsed = parseContainerSource(liveSource())
      draftTitle = parsed.title
      draftBody = parsed.body
      // Keep the stored source until the user edits — rebuild only normalizes
      // blank lines and would otherwise dirty an untouched block on Done.
      fitEditorToSource(editorValue)

      const done = document.createElement('button')
      done.type = 'button'
      done.className = 'desk-raw-block__edit desk-raw-block__edit--pill desk-raw-block__editor-done'
      done.innerHTML = `${DONE_PILL_ICON}<span>Done</span>`
      done.setAttribute('aria-label', 'Done')
      done.title = 'Done'
      done.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        commit()
      })

      const fields = document.createElement('div')
      fields.className = 'desk-raw-block__editor-fields'

      const titleInput = document.createElement('input')
      titleInput.type = 'text'
      titleInput.className = 'desk-raw-block__editor-title'
      titleInput.value = draftTitle
      titleInput.placeholder = '可选标题'
      titleInput.addEventListener('input', () => {
        draftTitle = titleInput.value
        publishDraft()
      })

      const cmHost = document.createElement('div')
      cmHost.className = 'desk-raw-block__editor-cm'
      fields.append(titleInput, cmHost)
      editorHost.append(done, fields)
      editorHost.hidden = false

      editorHandle = createContainerSourceEditor(
        cmHost,
        draftBody,
        (value) => {
          draftBody = value
          publishDraft()
        },
        () => commit(),
        {
          onEmptyBackspace: removeBlockOnEmptyBackspace,
          placeholder: '输入正文…'
        }
      )
    } else {
      const header = document.createElement('div')
      header.className = 'desk-raw-block__editor-header'
      const label = document.createElement('span')
      label.className = 'desk-raw-block__editor-label'
      label.textContent = ctx.label
      const done = document.createElement('button')
      done.type = 'button'
      done.className = 'desk-raw-block__editor-done'
      done.textContent = '完成'
      header.append(label, done)
      done.addEventListener('click', (event) => {
        event.preventDefault()
        commit()
      })

      fitEditorToSource(editorValue)
      const cmHost = document.createElement('div')
      cmHost.className = 'desk-raw-block__editor-cm'
      editorHost.append(header, cmHost)
      editorHost.hidden = false

      editorHandle = createContainerSourceEditor(
        cmHost,
        liveSource(),
        (value) => {
          if (isEffectivelyReadOnly()) return
          editorValue = value
          fitEditorToSource(value)
          if (syncTimer != null) clearTimeout(syncTimer)
          syncTimer = setTimeout(() => ctx.renderPreview(editorValue), 250)
        },
        () => commit(),
        { onEmptyBackspace: removeBlockOnEmptyBackspace }
      )
    }
    window.setTimeout(() => editorHandle?.focus(), 0)
  }

  editButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    startEditing()
  })
  rawSourceReadonlyListeners.add(applyReadonly)
  applyReadonly(isEffectivelyReadOnly())

  return () => {
    rawSourceReadonlyListeners.delete(applyReadonly)
    if (structured) {
      editorHost.removeEventListener('focusout', scheduleCommitOnBlur)
    }
    clearBlurCommit()
    if (syncTimer != null) clearTimeout(syncTimer)
    editorHandle?.destroy()
    editorHandle = null
  }
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

/**
 * 0005：斜杠菜单的 TNotes 项被选中时插入内容。
 * - 容器 / 导图 / 组件 / 代码组 / swiper：插入 markdown（走 raw 块投影），
 *   并自动打开新插入块的「编辑源码」。
 * - 普通代码块：走 Crepe 代码块（createCodeBlockCommand）。
 */
function runSlashItemInsert(item: SlashMenuItem): void {
  if (item.kind === 'code') {
    run((editor) => {
      editor.editor.action((ctx) => {
        const commands = ctx.get(commandsCtx)
        // The toolbar command intentionally preserves paragraph text. A slash
        // insertion must first remove its `/query`, just like Crepe's own menu.
        commands.call(clearTextInCurrentBlockCommand.key)
        commands.call(createCodeBlockCommand.key, 'js')
      })
    })
    return
  }

  // 斜杠菜单和块级快捷输入必须保留同一份 insert（包括末尾换行），
  // 因而两条入口都直接用 replaceCurrentParagraphWithItem 创建节点。
  // 新块定位：插入前后各取一次 deskRawBlock 原子的文档 pos 列表，
  // 通过「前缀 + 后缀」对齐找出新增原子（插入发生在文档任意位置，不能
  // 假设在末尾——例如用户在文档中间的空段落里打 `/`）。
  let newBlockPos: number | null = null
  run((editor) => {
    editor.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const before = rawBlockPositions(view.state.doc)
      const transaction = replaceCurrentParagraphWithItem(
        view.state,
        item,
        view.state.selection.from
      )
      if (!transaction) return
      view.dispatch(transaction)
      const after = rawBlockPositions(view.state.doc)
      newBlockPos = findAddedBlockPos(before, after)
    })
  })

  if (newBlockPos != null) openRawSourceEditorAt(newBlockPos)
}

/**
 * Raw NodeViews mount after their insertion transaction. Poll briefly, then
 * open and focus the inline source editor. Both slash insertion (0005) and
 * block shortcuts (0006) use this exact interaction path.
 */
function openRawSourceEditorAt(position: number): void {
  if (isEffectivelyReadOnly()) return
  let attempts = 0
  const tryOpen = (): void => {
    attempts += 1
    const view = crepe?.editor.action((ctx) => ctx.get(editorViewCtx))
    if (!view) {
      if (attempts >= 20) window.clearInterval(pollTimer)
      return
    }
    const dom = view.nodeDOM(position)
    if (!(dom instanceof HTMLElement)) {
      if (attempts >= 20) window.clearInterval(pollTimer)
      return
    }
    const editButton = dom.querySelector<HTMLButtonElement>('.desk-raw-block__edit')
    if (!editButton) {
      if (attempts >= 20) window.clearInterval(pollTimer)
      return
    }
    editButton.click()
    window.clearInterval(pollTimer)
  }
  const pollTimer = window.setInterval(tryOpen, 50)
  tryOpen()
}

/** 文档中所有 deskRawBlock 原子的 (pos, kind, source, hidden)，按文档序。 */
function rawBlockPositions(doc: {
  descendants: (
    fn: (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => void
  ) => void
}): Array<{ pos: number; signature: string }> {
  const found: Array<{ pos: number; signature: string }> = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'deskRawBlock') return
    found.push({
      pos,
      signature: `${String(node.attrs.kind)}\u0000${String(node.attrs.hidden)}\u0000${String(node.attrs.source)}`
    })
  })
  return found
}

/**
 * 插入前后 pos 列表 diff：返回第一个新增原子的 pos。
 * 用「前缀相同 + 后缀相同」对齐：新增项位于两者之间。
 */
function findAddedBlockPos(
  before: Array<{ pos: number; signature: string }>,
  after: Array<{ pos: number; signature: string }>
): number | null {
  const beforeSigs = before.map((item) => item.signature)
  const afterSigs = after.map((item) => item.signature)
  // 前缀对齐
  let prefix = 0
  while (
    prefix < beforeSigs.length &&
    prefix < afterSigs.length &&
    beforeSigs[prefix] === afterSigs[prefix]
  ) {
    prefix += 1
  }
  // 后缀对齐（不含已对齐前缀）
  let suffix = 0
  while (
    suffix < beforeSigs.length - prefix &&
    suffix < afterSigs.length - prefix &&
    beforeSigs[beforeSigs.length - 1 - suffix] === afterSigs[afterSigs.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const addedCount = afterSigs.length - beforeSigs.length
  if (addedCount <= 0) return null
  // 插入位置 = 前缀 + 新增项序号；返回第一个新增的 pos。
  const index = prefix
  if (index >= after.length) return null
  return after[index].pos
}

function focus(): void {
  if (!crepe || !ready || isEffectivelyReadOnly()) return
  crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
}

function applyReadonlyState(): void {
  const readOnly = isEffectivelyReadOnly()
  crepe?.setReadonly(readOnly)
  rawSourceReadonlyListeners.forEach((listener) => listener(readOnly))
  if (!readOnly) return

  closeBlockActionMenu(false)
  const view = editorView()
  if (!view) return
  clearRawBlockSelectionState(view)
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && view.dom.contains(activeElement)) {
    activeElement.blur()
  }
  view.dom.blur()
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

  // Crepe/Milkdown Copy uses navigator.clipboard.writeText and only sync-catches
  // failures, so Electron's async NotAllowedError never falls back. Intercept
  // in capture and use Desk's permission-safe path instead.
  const copyButton = event.target.closest('.milkdown-code-block .copy-button')
  if (copyButton instanceof HTMLElement) {
    event.preventDefault()
    event.stopPropagation()
    const block = copyButton.closest('.milkdown-code-block')
    const text = block ? readCodeBlockPlainText(block) : ''
    void writeClipboard(text)
      .then(() => {
        copyButton.dataset.copied = 'true'
        window.setTimeout(() => {
          delete copyButton.dataset.copied
        }, 1200)
      })
      .catch(() => {
        /* writeClipboard already falls back; ignore residual errors */
      })
    return
  }

  const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
  if (!anchor) return
  const href = anchor.getAttribute('href') ?? ''

  // NotesTable rows use desk-note://<uuid> so clicks open the note in Desk.
  if (href.startsWith('desk-note://')) {
    event.preventDefault()
    event.stopPropagation()
    let noteUuid = href.slice('desk-note://'.length)
    try {
      noteUuid = decodeURIComponent(noteUuid)
    } catch {
      /* keep raw */
    }
    if (noteUuid) emit('openNote', noteUuid)
    return
  }

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
  slashMenuPresentationCleanup = installSlashMenuPresentation(host.value)
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
      },
      [Crepe.Feature.Cursor]: {
        color: 'var(--accent-strong)',
        width: 4
      },
      [Crepe.Feature.BlockEdit]: {
        buildMenu: (builder) => {
          buildTNotesSlashGroup(builder, {
            groupLabel: 'TNotes',
            onRun: (item) => {
              runSlashItemInsert(item)
            }
          })
        }
      }
    }
  })
  editor.editor.use(rawBlockProjectionPlugins)
  editor.editor.use(createCodeBlockTitlePlugin())
  editor.editor.use(createMarkdownShortcutInputRules())
  editor.editor.use(
    createBlockShortcutPlugin({
      onRawBlockInserted: openRawSourceEditorAt
    })
  )
  editor.editor.use(createRawBlockSelectionPlugin())
  editor.editor.use(
    createReadonlyTransactionGuard({
      isReadOnly: isEffectivelyReadOnly,
      isExternalSync: () => synchronizing
    })
  )
  editor.editor.use(
    $view(deskRawBlockSchema.node, () => (node, view, getPos) => {
      const block = {
        kind: String(node.attrs.kind) as ProjectedRawBlockKind,
        source: String(node.attrs.source),
        hidden: Boolean(node.attrs.hidden)
      }
      const resolveImage = (source: string): string =>
        resolveMarkdownImageUrl(source, props.knowledgeBaseId, props.noteUuid)
      const dom = renderDeskRawBlockElement(block, resolveImage)
      const cleanupTasks: Array<() => void> = []
      let currentRawNode = node
      if (!block.hidden) {
        cleanupTasks.push(attachRawBlockBoundaryControls({ dom, view, getPos }))
      }
      if (block.kind === 'raw-include') {
        const include = parseDeskIncludeLine(block.source)
        const editable = !isEffectivelyReadOnly()
        dom.classList.add('desk-raw-block--include')
        if (editable) dom.classList.add('desk-raw-block--include-editable')

        const labelEl = dom.querySelector('.desk-raw-block__label')
        if (labelEl && include) {
          const titlePart = include.title ? ` · ${include.title}` : ''
          labelEl.textContent = `文件引用 · ${include.path}${titlePart}`
        }

        const previewEl = dom.querySelector('.desk-raw-block__preview')
        const bodyHost = document.createElement('div')
        bodyHost.className = 'desk-raw-block__include-body'
        if (previewEl) previewEl.replaceWith(bodyHost)
        else dom.append(bodyHost)

        let cancelled = false
        let tabEditor: CodeTabEditorHandle | null = null
        cleanupTasks.push(() => {
          cancelled = true
          tabEditor?.destroy()
          tabEditor = null
        })

        void (async () => {
          if (!include) {
            bodyHost.textContent = '无法解析文件引用'
            return
          }
          try {
            const result = await window.desk.attachments.readText({
              knowledgeBaseId: props.knowledgeBaseId,
              noteUuid: props.noteUuid,
              path: include.path
            })
            if (cancelled) return
            if (!result.ok) {
              bodyHost.textContent = `引用失败：${result.error.message}`
              return
            }

            if (!editable) {
              const pre = document.createElement('pre')
              pre.className = 'desk-raw-block__include-pre'
              pre.textContent = result.value
              bodyHost.replaceChildren(pre)
              return
            }

            tabEditor = mountCodeTabEditor(bodyHost, {
              initialContent: result.value,
              language: includeLanguage(include),
              onCopy: (text) => writeClipboard(text),
              onDirtyChange: (dirty) => {
                dom.classList.toggle('is-include-dirty', dirty)
              },
              onSave: async (content) => {
                const write = await window.desk.attachments.writeText({
                  knowledgeBaseId: props.knowledgeBaseId,
                  noteUuid: props.noteUuid,
                  path: include.path,
                  content
                })
                if (!write.ok) return { ok: false, message: write.error.message }
                return { ok: true }
              }
            })
          } catch (error) {
            if (cancelled) return
            bodyHost.textContent = `引用失败：${error instanceof Error ? error.message : String(error)}`
          }
        })()
      }
      if (block.kind === 'raw-container') {
        const container = parseContainerSource(block.source)
        if (container.name === 'footprints') {
          dom.classList.add('desk-raw-block--footprints')
          dom.replaceChildren()
          const previewHost = document.createElement('div')
          previewHost.className = 'desk-raw-block__component-preview'
          dom.append(previewHost)
          // Resolve note-local image paths for preview only; source keeps relative URLs.
          const resolveFootprintsPreview = (source: string): FootprintsPayload => {
            const payload = parseFootprintsSource(source)
            return {
              ...payload,
              images: payload.images.map((src) => resolveImage(src))
            }
          }
          const mounted = mountFootprintsPreview(
            previewHost,
            resolveFootprintsPreview(block.source)
          )
          cleanupTasks.push(() => mounted.unmount())
          cleanupTasks.push(
            attachRawSourceEditor({
              dom,
              source: block.source,
              view,
              getPos,
              label: '编辑 Footprints',
              structuredContainerBody: true,
              renderPreview: (source) => {
                mounted.update(resolveFootprintsPreview(source))
              }
            })
          )
        } else {
          let previewEl = dom.querySelector('.tn-swiper, .custom-block') as HTMLElement | null
          const structuredCallout = isStructuredCalloutSource(block.source)
          const structuredContainerBody =
            container.name === 'code-group' || container.name === 'swiper'
          const editable = !isEffectivelyReadOnly()

          let cancelledIncludes = false
          let currentContainerSource = block.source
          let codeGroupEntries: CodeGroupEntry[] = []
          let swiperSlides: SwiperSlideEntry[] = []
          const codeGroupTabEditors: Array<CodeTabEditorHandle | null> = []
          cleanupTasks.push(() => {
            cancelledIncludes = true
            codeGroupTabEditors.splice(0).forEach((handle) => handle?.destroy())
          })

          const loadIncludeCache = async (body: string): Promise<Map<string, string>> => {
            const cache = new Map<string, string>()
            for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
              const include = parseDeskIncludeLine(line)
              if (!include || cache.has(include.path)) continue
              try {
                const result = await window.desk.attachments.readText({
                  knowledgeBaseId: props.knowledgeBaseId,
                  noteUuid: props.noteUuid,
                  path: include.path
                })
                cache.set(
                  include.path,
                  result.ok ? result.value : `// 引用失败：${result.error.message}`
                )
              } catch (error) {
                cache.set(
                  include.path,
                  `// 引用失败：${error instanceof Error ? error.message : String(error)}`
                )
              }
            }
            return cache
          }

          const applyContainerSource = (nextSource: string): boolean => {
            const position = getPos()
            if (position == null) return false
            const currentNode = view.state.doc.nodeAt(position)
            if (currentNode?.type.name !== 'deskRawBlock') return false
            view.dispatch(
              view.state.tr.setNodeMarkup(position, undefined, {
                ...(currentNode.attrs as Record<string, unknown>),
                source: nextSource
              })
            )
            return true
          }

          const commitCodeGroupEntries = (nextEntries: CodeGroupEntry[]): boolean => {
            const nextSource = rebuildContainerSource(currentContainerSource, {
              title: parseContainerSource(currentContainerSource).title,
              body: serializeCodeGroupEntries(nextEntries),
              name: 'code-group'
            })
            if (!applyContainerSource(nextSource)) return false
            currentContainerSource = nextSource
            codeGroupEntries = nextEntries
            return true
          }

          const remountEditableCodeGroup = async (): Promise<void> => {
            if (!previewEl) return
            const fresh = await mountEditableCodeGroup(currentContainerSource)
            if (cancelledIncludes || !previewEl || !fresh) return
            previewEl.replaceWith(fresh)
            previewEl = fresh
          }

          const mountEditableCodeGroup = async (source: string): Promise<HTMLElement | null> => {
            const parsed = parseContainerSource(source)
            if (parsed.name !== 'code-group') return null
            const entries = parseCodeGroupEntries(parsed.body)
            if (entries.length === 0) return null

            const cache = await loadIncludeCache(parsed.body)
            if (cancelledIncludes) return null

            codeGroupTabEditors.splice(0).forEach((handle) => handle?.destroy())
            codeGroupEntries = entries

            const group = document.createElement('div')
            group.className =
              'custom-block custom-block-code-group desk-raw-block--code-group-editable'

            const useTabs = entries.length > 1
            const tabs = document.createElement('div')
            tabs.className = 'code-group-tabs'
            const panels = document.createElement('div')
            panels.className = useTabs ? 'code-group-panels' : 'custom-block-body'
            const tabButtons: HTMLButtonElement[] = []
            const panelEls: HTMLDivElement[] = []
            const DRAG_THRESHOLD_PX = 8

            const activateTab = (index: number): void => {
              tabButtons.forEach((button, buttonIndex) =>
                button.classList.toggle('active', buttonIndex === index)
              )
              panelEls.forEach((pane, paneIndex) =>
                pane.classList.toggle('active', paneIndex === index)
              )
            }

            const swapAdjacent = <T,>(items: T[], index: number, toward: -1 | 1): void => {
              const other = index + toward
              const a = items[index]
              const b = items[other]
              if (a === undefined || b === undefined) return
              items[index] = b
              items[other] = a
            }

            const naturalLeft = (el: HTMLElement): number => {
              const prev = el.style.transform
              el.style.transform = 'none'
              const left = el.getBoundingClientRect().left
              el.style.transform = prev
              return left
            }

            const finishTabReorder = async (
              startIndices: number[],
              didReorder: boolean
            ): Promise<void> => {
              if (!didReorder) return
              await Promise.all(
                codeGroupTabEditors.map((handle) =>
                  handle?.isDirty() ? handle.flushSave() : Promise.resolve()
                )
              )
              if (cancelledIncludes) return
              const snapshot = codeGroupEntries.slice()
              const nextEntries = startIndices.map((startIndex) => snapshot[startIndex]!)
              if (nextEntries.some((entry) => entry == null)) return
              if (!commitCodeGroupEntries(nextEntries)) return
              await remountEditableCodeGroup()
            }

            const bindTabDragReorder = (tab: HTMLButtonElement, index: number): void => {
              tab.dataset.startIndex = String(index)
              let pointerId: number | null = null
              let grabOffsetX = 0
              let startClientX = 0
              let activated = false
              let currentIndex = index
              let suppressClick = false

              const clearDragVisual = (): void => {
                tab.classList.remove('is-dragging')
                tab.style.transform = ''
                tab.style.zIndex = ''
                tabs.classList.remove('is-reordering')
              }

              tab.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return
                if (tab.querySelector('input')) return
                pointerId = event.pointerId
                currentIndex = tabButtons.indexOf(tab)
                if (currentIndex < 0) return
                startClientX = event.clientX
                grabOffsetX = event.clientX - tab.getBoundingClientRect().left
                activated = false
                suppressClick = false
                tab.setPointerCapture(event.pointerId)
              })

              tab.addEventListener('pointermove', (event) => {
                if (pointerId !== event.pointerId) return
                currentIndex = tabButtons.indexOf(tab)
                if (currentIndex < 0) return

                if (!activated) {
                  if (Math.abs(event.clientX - startClientX) < DRAG_THRESHOLD_PX) return
                  activated = true
                  suppressClick = true
                  tab.classList.add('is-dragging')
                  tabs.classList.add('is-reordering')
                }

                // Keep the dragged tab under the pointer.
                const baseLeft = naturalLeft(tab)
                tab.style.transform = `translateX(${event.clientX - grabOffsetX - baseLeft}px)`
                tab.style.zIndex = '5'

                const dragCenter = event.clientX - grabOffsetX + tab.offsetWidth / 2

                // Squeeze only after crossing a neighbor's midpoint.
                if (currentIndex > 0) {
                  const leftTab = tabButtons[currentIndex - 1]!
                  const leftCenter =
                    leftTab.getBoundingClientRect().left + leftTab.offsetWidth / 2
                  if (dragCenter < leftCenter) {
                    tabs.insertBefore(tab, leftTab)
                    swapAdjacent(tabButtons, currentIndex, -1)
                    currentIndex -= 1
                    const nextBase = naturalLeft(tab)
                    tab.style.transform = `translateX(${event.clientX - grabOffsetX - nextBase}px)`
                  }
                }
                if (currentIndex < tabButtons.length - 1) {
                  const rightTab = tabButtons[currentIndex + 1]!
                  const rightCenter =
                    rightTab.getBoundingClientRect().left + rightTab.offsetWidth / 2
                  if (dragCenter > rightCenter) {
                    tabs.insertBefore(rightTab, tab)
                    swapAdjacent(tabButtons, currentIndex, 1)
                    currentIndex += 1
                    const nextBase = naturalLeft(tab)
                    tab.style.transform = `translateX(${event.clientX - grabOffsetX - nextBase}px)`
                  }
                }
              })

              const endPointer = (event: PointerEvent): void => {
                if (pointerId !== event.pointerId) return
                pointerId = null
                try {
                  tab.releasePointerCapture(event.pointerId)
                } catch {
                  /* already released */
                }
                const didReorder = activated
                const startIndices = tabButtons.map((button) => Number(button.dataset.startIndex))
                const orderChanged =
                  didReorder && startIndices.some((startIndex, i) => startIndex !== i)
                clearDragVisual()
                if (orderChanged) {
                  void finishTabReorder(startIndices, true)
                  return
                }
                if (!suppressClick) {
                  const activeIndex = tabButtons.findIndex((button) =>
                    button.classList.contains('active')
                  )
                  const clickIndex = tabButtons.indexOf(tab)
                  if (clickIndex < 0 || activeIndex === clickIndex) return
                  const previous = codeGroupTabEditors[activeIndex]
                  void (async () => {
                    if (previous?.isDirty()) await previous.flushSave()
                    if (cancelledIncludes) return
                    activateTab(clickIndex)
                  })()
                }
              }

              tab.addEventListener('pointerup', endPointer)
              tab.addEventListener('pointercancel', endPointer)
            }

            const startTabRename = (tab: HTMLButtonElement, index: number): void => {
              if (tab.querySelector('input')) return
              const entry = codeGroupEntries[index]
              if (!entry) return
              const previousTitle = codeGroupEntryTabTitle(entry, index)
              const input = document.createElement('input')
              input.type = 'text'
              input.className = 'code-group-tab__rename'
              input.value = previousTitle
              input.setAttribute('aria-label', '重命名代码块标题')
              tab.replaceChildren(input)
              input.focus()
              input.select()

              let finished = false
              const finish = (commit: boolean): void => {
                if (finished) return
                finished = true
                const nextTitle = commit ? input.value.trim() : previousTitle
                const current = codeGroupEntries[index]
                if (!current) {
                  tab.textContent = previousTitle
                  return
                }
                if (commit && nextTitle && nextTitle !== previousTitle) {
                  const nextEntries = codeGroupEntries.map((item, itemIndex) =>
                    itemIndex === index ? withCodeGroupEntryTitle(item, nextTitle) : item
                  )
                  if (!commitCodeGroupEntries(nextEntries)) {
                    tab.textContent = previousTitle
                    return
                  }
                  tab.textContent = codeGroupEntryTabTitle(nextEntries[index]!, index)
                  return
                }
                tab.textContent = codeGroupEntryTabTitle(current, index)
              }

              input.addEventListener('keydown', (event) => {
                event.stopPropagation()
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
                  event.preventDefault()
                  input.select()
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  finish(true)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  finish(false)
                }
              })
              input.addEventListener('blur', () => finish(true))
              input.addEventListener('click', (event) => event.stopPropagation())
              input.addEventListener('mousedown', (event) => event.stopPropagation())
            }

            entries.forEach((entry, index) => {
              const panel = document.createElement('div')
              panel.className = useTabs
                ? 'code-group-panel desk-raw-block__code-group-panel'
                : 'desk-raw-block__code-group-panel'
              const editorHost = document.createElement('div')
              editorHost.className = 'desk-raw-block__include-body'
              panel.append(editorHost)

              let initialContent = ''
              let language = ''
              if (entry.kind === 'include') {
                initialContent = cache.get(entry.include.path) ?? `// 引用失败：${entry.include.path}`
                language = includeLanguage(entry.include)
              } else {
                initialContent = entry.code
                language = entry.lang
              }

              const tabEditor = mountCodeTabEditor(editorHost, {
                initialContent,
                language,
                onCopy: (text) => writeClipboard(text),
                onDirtyChange: (dirty) => {
                  tabButtons[index]?.classList.toggle('is-tab-dirty', dirty)
                  panel.classList.toggle('is-include-dirty', dirty)
                },
                onLanguageChange: async (nextLanguage) => {
                  const current = codeGroupEntries[index]
                  if (!current) return
                  const nextEntries = codeGroupEntries.map((item, itemIndex) =>
                    itemIndex === index ? withCodeGroupEntryLanguage(item, nextLanguage) : item
                  )
                  if (!commitCodeGroupEntries(nextEntries)) {
                    const revertLang =
                      current.kind === 'include'
                        ? includeLanguage(current.include)
                        : current.lang || 'text'
                    codeGroupTabEditors[index]?.setLanguage(revertLang)
                  }
                },
                onSave: async (content) => {
                  const current = codeGroupEntries[index]
                  if (!current) return { ok: false, message: '代码块已失效' }
                  if (current.kind === 'include') {
                    const write = await window.desk.attachments.writeText({
                      knowledgeBaseId: props.knowledgeBaseId,
                      noteUuid: props.noteUuid,
                      path: current.include.path,
                      content
                    })
                    if (!write.ok) return { ok: false, message: write.error.message }
                    return { ok: true }
                  }
                  const nextEntries = codeGroupEntries.map((item, itemIndex) =>
                    itemIndex === index && item.kind === 'fence'
                      ? { ...item, code: content.replace(/\n$/, '') }
                      : item
                  )
                  if (!commitCodeGroupEntries(nextEntries)) {
                    return { ok: false, message: '无法更新笔记节点' }
                  }
                  return { ok: true }
                }
              })
              codeGroupTabEditors[index] = tabEditor

              if (useTabs) {
                const tab = document.createElement('button')
                tab.type = 'button'
                tab.className = 'code-group-tab'
                tab.textContent = codeGroupEntryTabTitle(entry, index)
                tab.title = '拖拽排序 · 双击重命名'
                if (index === 0) {
                  tab.classList.add('active')
                  panel.classList.add('active')
                }
                tab.addEventListener('dblclick', (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const entryIndex = Number(tab.dataset.startIndex)
                  if (Number.isNaN(entryIndex)) return
                  startTabRename(tab, entryIndex)
                })
                tabButtons.push(tab)
                tabs.append(tab)
                bindTabDragReorder(tab, index)
              } else {
                panel.classList.add('active')
              }
              panelEls.push(panel)
              panels.append(panel)
            })

            if (useTabs) group.append(tabs, panels)
            else group.append(panels)
            return group
          }

          const commitSwiperSlides = (nextSlides: SwiperSlideEntry[]): boolean => {
            const nextSource = rebuildContainerSource(currentContainerSource, {
              title: parseContainerSource(currentContainerSource).title,
              body: serializeSwiperSlides(nextSlides),
              name: 'swiper'
            })
            if (!applyContainerSource(nextSource)) return false
            currentContainerSource = nextSource
            swiperSlides = nextSlides
            return true
          }

          const remountEditableSwiper = (activeIndex?: number): void => {
            if (!previewEl) return
            const fresh = mountEditableSwiper(currentContainerSource, {
              activeIndex: activeIndex ?? readActiveSwiperIndex()
            })
            if (cancelledIncludes || !previewEl || !fresh) return
            previewEl.replaceWith(fresh)
            previewEl = fresh
          }

          const readActiveSwiperIndex = (): number => {
            if (!previewEl) return 0
            const tabs = [...previewEl.querySelectorAll('.tn-swiper-tabs .tn-tab')]
            const found = tabs.findIndex((tab) => tab.classList.contains('active'))
            return found >= 0 ? found : 0
          }

          const mountEditableSwiper = (
            source: string,
            options?: { activeIndex?: number }
          ): HTMLElement | null => {
            const parsed = parseContainerSource(source)
            if (parsed.name !== 'swiper') return null
            const slides = parseSwiperSlides(parsed.body)
            if (slides.length === 0) return null

            swiperSlides = slides
            const initialActiveIndex = Math.min(
              Math.max(0, options?.activeIndex ?? 0),
              slides.length - 1
            )
            const root = document.createElement('div')
            root.className = 'tn-swiper desk-raw-block--swiper-editable'

            const useTabs = slides.length > 1
            const tabs = document.createElement('div')
            tabs.className = 'tn-swiper-tabs'
            const container = document.createElement('div')
            container.className = 'swiper-container'
            const wrapper = document.createElement('div')
            wrapper.className = 'swiper-wrapper'
            const tabButtons: HTMLButtonElement[] = []
            const slideEls: HTMLDivElement[] = []
            const DRAG_THRESHOLD_PX = 8

            const activateSlide = (index: number): void => {
              tabButtons.forEach((button, buttonIndex) =>
                button.classList.toggle('active', buttonIndex === index)
              )
              slideEls.forEach((slide, slideIndex) => {
                const on = slideIndex === index
                slide.classList.toggle('is-active', on)
                slide.hidden = !on
              })
            }

            const activeSlideIndex = (): number => {
              const found = tabButtons.findIndex((button) => button.classList.contains('active'))
              return found >= 0 ? found : 0
            }

            applySwiperTabsPadding(tabs, useTabs)
            const nav = useTabs
              ? createSwiperTabNav({
                  onPrev: () =>
                    activateSlide(wrapSlideIndex(activeSlideIndex(), slides.length, -1)),
                  onNext: () => activateSlide(wrapSlideIndex(activeSlideIndex(), slides.length, 1))
                })
              : null
            if (nav) tabs.append(nav.prev, nav.line)

            const swapAdjacent = <T,>(items: T[], index: number, toward: -1 | 1): void => {
              const other = index + toward
              const a = items[index]
              const b = items[other]
              if (a === undefined || b === undefined) return
              items[index] = b
              items[other] = a
            }

            const naturalLeft = (el: HTMLElement): number => {
              const prev = el.style.transform
              el.style.transform = 'none'
              const left = el.getBoundingClientRect().left
              el.style.transform = prev
              return left
            }

            const finishTabReorder = (startIndices: number[], didReorder: boolean): void => {
              if (!didReorder) return
              const snapshot = swiperSlides.slice()
              const nextSlides = startIndices.map((startIndex) => snapshot[startIndex]!)
              if (nextSlides.some((entry) => entry == null)) return
              const keepIndex = activeSlideIndex()
              if (!commitSwiperSlides(nextSlides)) return
              remountEditableSwiper(keepIndex)
            }

            const bindTabDragReorder = (tab: HTMLButtonElement, index: number): void => {
              tab.dataset.startIndex = String(index)
              let pointerId: number | null = null
              let grabOffsetX = 0
              let startClientX = 0
              let activated = false
              let currentIndex = index
              let suppressClick = false

              const clearDragVisual = (): void => {
                tab.classList.remove('is-dragging')
                tab.style.transform = ''
                tab.style.zIndex = ''
                tabs.classList.remove('is-reordering')
              }

              tab.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return
                if (tab.querySelector('input')) return
                pointerId = event.pointerId
                currentIndex = tabButtons.indexOf(tab)
                if (currentIndex < 0) return
                startClientX = event.clientX
                grabOffsetX = event.clientX - tab.getBoundingClientRect().left
                activated = false
                suppressClick = false
                tab.setPointerCapture(event.pointerId)
              })

              tab.addEventListener('pointermove', (event) => {
                if (pointerId !== event.pointerId) return
                currentIndex = tabButtons.indexOf(tab)
                if (currentIndex < 0) return

                if (!activated) {
                  if (Math.abs(event.clientX - startClientX) < DRAG_THRESHOLD_PX) return
                  activated = true
                  suppressClick = true
                  tab.classList.add('is-dragging')
                  tabs.classList.add('is-reordering')
                }

                const baseLeft = naturalLeft(tab)
                tab.style.transform = `translateX(${event.clientX - grabOffsetX - baseLeft}px)`
                tab.style.zIndex = '5'

                const dragCenter = event.clientX - grabOffsetX + tab.offsetWidth / 2

                if (currentIndex > 0) {
                  const leftTab = tabButtons[currentIndex - 1]!
                  const leftCenter =
                    leftTab.getBoundingClientRect().left + leftTab.offsetWidth / 2
                  if (dragCenter < leftCenter) {
                    tabs.insertBefore(tab, leftTab)
                    swapAdjacent(tabButtons, currentIndex, -1)
                    currentIndex -= 1
                    const nextBase = naturalLeft(tab)
                    tab.style.transform = `translateX(${event.clientX - grabOffsetX - nextBase}px)`
                  }
                }
                if (currentIndex < tabButtons.length - 1) {
                  const rightTab = tabButtons[currentIndex + 1]!
                  const rightCenter =
                    rightTab.getBoundingClientRect().left + rightTab.offsetWidth / 2
                  if (dragCenter > rightCenter) {
                    tabs.insertBefore(rightTab, tab)
                    swapAdjacent(tabButtons, currentIndex, 1)
                    currentIndex += 1
                    const nextBase = naturalLeft(tab)
                    tab.style.transform = `translateX(${event.clientX - grabOffsetX - nextBase}px)`
                  }
                }
              })

              const endPointer = (event: PointerEvent): void => {
                if (pointerId !== event.pointerId) return
                pointerId = null
                try {
                  tab.releasePointerCapture(event.pointerId)
                } catch {
                  /* ignore */
                }
                const didReorder = activated
                const startIndices = tabButtons.map((button) => Number(button.dataset.startIndex))
                const orderChanged =
                  didReorder && startIndices.some((startIndex, i) => startIndex !== i)
                clearDragVisual()
                if (orderChanged) {
                  finishTabReorder(startIndices, true)
                  return
                }
                if (!suppressClick) {
                  const clickIndex = tabButtons.indexOf(tab)
                  if (clickIndex >= 0) activateSlide(clickIndex)
                }
              }

              tab.addEventListener('pointerup', endPointer)
              tab.addEventListener('pointercancel', endPointer)
            }

            const startTabRename = (tab: HTMLButtonElement, index: number): void => {
              if (tab.querySelector('input')) return
              const entry = swiperSlides[index]
              if (!entry) return
              const previousTitle = swiperSlideTabTitle(entry)
              const input = document.createElement('input')
              input.type = 'text'
              input.className = 'tn-tab__rename'
              input.value = previousTitle === 'img' && !entry.alt.trim() ? '' : previousTitle
              input.setAttribute('aria-label', '重命名轮播页标题')
              tab.replaceChildren(input)
              input.focus()
              input.select()

              let finished = false
              const finish = (commit: boolean): void => {
                if (finished) return
                finished = true
                const nextTitle = commit ? input.value.trim() : previousTitle
                const current = swiperSlides[index]
                if (!current) {
                  tab.textContent = previousTitle
                  return
                }
                if (commit && nextTitle !== previousTitle) {
                  const nextSlides = swiperSlides.map((item, itemIndex) =>
                    itemIndex === index ? withSwiperSlideTitle(item, nextTitle) : item
                  )
                  if (!commitSwiperSlides(nextSlides)) {
                    tab.textContent = previousTitle
                    return
                  }
                  const label = swiperSlideTabTitle(nextSlides[index]!)
                  tab.textContent = label
                  slideEls[index]!.dataset.title = label
                  return
                }
                tab.textContent = swiperSlideTabTitle(current)
              }

              input.addEventListener('keydown', (event) => {
                // Keep shortcuts (Cmd/Ctrl+A, etc.) on this native input instead of
                // letting ProseMirror / Milkdown handle them at the doc level.
                event.stopPropagation()
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
                  event.preventDefault()
                  input.select()
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  finish(true)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  finish(false)
                }
              })
              input.addEventListener('blur', () => finish(true))
              input.addEventListener('click', (event) => event.stopPropagation())
              input.addEventListener('mousedown', (event) => event.stopPropagation())
            }

            slides.forEach((slide, index) => {
              const slideEl = document.createElement('div')
              slideEl.className = 'swiper-slide'
              const title = swiperSlideTabTitle(slide)
              slideEl.dataset.title = title
              const img = document.createElement('img')
              img.src = resolveImage(slide.src) || slide.src
              img.alt = slide.alt
              slideEl.append(img)
              if (index === initialActiveIndex) slideEl.classList.add('is-active')
              else slideEl.hidden = true
              slideEls.push(slideEl)
              wrapper.append(slideEl)

              if (useTabs) {
                const tab = document.createElement('button')
                tab.type = 'button'
                tab.className = 'tn-tab'
                tab.textContent = title
                tab.title = '拖拽排序 · 双击重命名'
                if (index === initialActiveIndex) tab.classList.add('active')
                tab.addEventListener('dblclick', (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const entryIndex = Number(tab.dataset.startIndex)
                  if (Number.isNaN(entryIndex)) return
                  startTabRename(tab, entryIndex)
                })
                tabButtons.push(tab)
                tabs.append(tab)
                bindTabDragReorder(tab, index)
              }
            })

            if (nav) tabs.append(nav.next)

            container.append(wrapper)
            if (useTabs) root.append(tabs, container)
            else root.append(container)
            return root
          }

          const refreshContainerPreview = async (source: string): Promise<void> => {
            if (!previewEl) return
            currentContainerSource = source
            const parsed = parseContainerSource(source)

            if (parsed.name === 'code-group' && editable) {
              const entries = parseCodeGroupEntries(parsed.body)
              if (entries.length > 0) {
                const fresh = await mountEditableCodeGroup(source)
                if (cancelledIncludes || !previewEl || !fresh) return
                previewEl.replaceWith(fresh)
                previewEl = fresh
                return
              }
            }

            if (parsed.name === 'swiper' && editable) {
              const slides = parseSwiperSlides(parsed.body)
              if (slides.length > 0) {
                const activeIndex = readActiveSwiperIndex()
                const fresh = mountEditableSwiper(source, { activeIndex })
                if (cancelledIncludes || !previewEl || !fresh) return
                previewEl.replaceWith(fresh)
                previewEl = fresh
                return
              }
            }

            let resolveIncludeContent: ((path: string) => string | null) | undefined
            if (parsed.name === 'code-group' && bodyHasIncludeLines(parsed.body)) {
              const cache = await loadIncludeCache(parsed.body)
              if (cancelledIncludes) return
              resolveIncludeContent = (path) => cache.get(path) ?? null
            }
            if (cancelledIncludes || !previewEl) return
            codeGroupTabEditors.splice(0).forEach((handle) => handle?.destroy())
            const fresh = renderContainerFromSource(source, resolveImage, {
              resolveIncludeContent
            })
            previewEl.replaceWith(fresh)
            previewEl = fresh
          }

          if (container.name === 'code-group' || (container.name === 'swiper' && editable)) {
            void refreshContainerPreview(block.source)
            if (container.name === 'code-group') {
              const acceptWriteback = (nextSource: string): boolean => {
                const nextParsed = parseContainerSource(nextSource)
                if (nextParsed.name !== 'code-group') return false
                const nextEntries = parseCodeGroupEntries(nextParsed.body)
                if (nextEntries.length !== codeGroupEntries.length) return false
                for (let i = 0; i < codeGroupEntries.length; i++) {
                  const prev = codeGroupEntries[i]
                  const next = nextEntries[i]
                  if (!prev || !next || prev.kind !== next.kind) return false
                  if (
                    prev.kind === 'include' &&
                    next.kind === 'include' &&
                    prev.include.path !== next.include.path
                  ) {
                    return false
                  }
                }
                currentContainerSource = nextSource
                codeGroupEntries = nextEntries
                nextEntries.forEach((entry, index) => {
                  if (entry.kind === 'fence') {
                    codeGroupTabEditors[index]?.setSavedValue(entry.code)
                  }
                })
                return true
              }
              ;(
                dom as HTMLElement & {
                  __codeGroupWriteback?: { acceptWriteback: (source: string) => boolean }
                }
              ).__codeGroupWriteback = { acceptWriteback }
              cleanupTasks.push(() => {
                delete (
                  dom as HTMLElement & {
                    __codeGroupWriteback?: { acceptWriteback: (source: string) => boolean }
                  }
                ).__codeGroupWriteback
              })
            }
            if (container.name === 'swiper' && editable) {
              const acceptSwiperWriteback = (nextSource: string): boolean => {
                const nextParsed = parseContainerSource(nextSource)
                if (nextParsed.name !== 'swiper') return false
                const nextSlides = parseSwiperSlides(nextParsed.body)
                if (nextSlides.length !== swiperSlides.length) return false
                currentContainerSource = nextSource
                swiperSlides = nextSlides
                return true
              }
              ;(
                dom as HTMLElement & {
                  __swiperWriteback?: { acceptWriteback: (source: string) => boolean }
                }
              ).__swiperWriteback = { acceptWriteback: acceptSwiperWriteback }
              cleanupTasks.push(() => {
                delete (
                  dom as HTMLElement & {
                    __swiperWriteback?: { acceptWriteback: (source: string) => boolean }
                  }
                ).__swiperWriteback
              })
            }
          }

          cleanupTasks.push(
            attachRawSourceEditor({
              dom,
              source: block.source,
              getSource: () => currentContainerSource,
              view,
              getPos,
              label: structuredCallout
                ? '编辑容器'
                : structuredContainerBody
                  ? '编辑容器正文'
                  : '编辑容器源码',
              structuredCallout,
              structuredContainerBody,
              renderPreview: (source) => {
                void refreshContainerPreview(source)
              }
            })
          )
        }
      }
      if (block.kind === 'raw-component') {
        if (isBilibiliVideoSource(block.source)) {
          dom.classList.add('desk-raw-block--component', 'desk-raw-block--bilibili-video')
          dom.replaceChildren()
          const previewHost = document.createElement('div')
          previewHost.className = 'desk-raw-block__component-preview'
          dom.append(previewHost)
          const parsed = parseBilibiliVideoSource(block.source)
          let mounted = mountBilibiliVideoPreview(previewHost, {
            id: parsed?.id ?? '',
            autoplay: parsed?.autoplay,
            muted: parsed?.muted
          })
          cleanupTasks.push(() => mounted.unmount())
          cleanupTasks.push(
            attachRawSourceEditor({
              dom,
              source: block.source,
              view,
              getPos,
              label: '编辑 B 站视频',
              structuredBilibili: true,
              renderPreview: (source) => {
                const next = parseBilibiliVideoSource(source)
                mounted.update({
                  id: next?.id ?? '',
                  autoplay: next?.autoplay,
                  muted: next?.muted
                })
              }
            })
          )
        } else if (isWordListSource(block.source)) {
          dom.classList.add('desk-raw-block--component', 'desk-raw-block--word-list')
          dom.replaceChildren()
          const previewHost = document.createElement('div')
          previewHost.className = 'desk-raw-block__component-preview'
          dom.append(previewHost)
          const parsed = parseWordListSource(block.source)
          const mounted = mountWordListPreview(previewHost, {
            words: parsed?.words ?? [],
            needSort: parsed?.needSort
          })
          cleanupTasks.push(() => mounted.unmount())
          cleanupTasks.push(
            attachRawSourceEditor({
              dom,
              source: block.source,
              view,
              getPos,
              label: '编辑单词表',
              structuredWordList: true,
              renderPreview: (source) => {
                const next = parseWordListSource(source)
                mounted.update({
                  words: next?.words ?? [],
                  needSort: next?.needSort
                })
              }
            })
          )
        } else if (isNotesTableSource(block.source)) {
          dom.classList.add('desk-raw-block--component', 'desk-raw-block--notes-table')
          dom.replaceChildren()
          const previewHost = document.createElement('div')
          previewHost.className = 'desk-raw-block__component-preview'
          dom.append(previewHost)
          const parsed = parseNotesTableSource(block.source)
          const ids = parsed?.ids ?? []
          const mounted = mountNotesTablePreview(previewHost, {
            notes: [],
            missingIds: [],
            error: ids.length ? null : '错误: ids 数组不能为空'
          })
          cleanupTasks.push(() => mounted.unmount())

          const applyNotesTableIds = (nextIds: string[]): void => {
            if (!nextIds.length) {
              mounted.update({
                notes: [],
                missingIds: [],
                error: '错误: ids 数组不能为空'
              })
              return
            }
            void window.desk.notes
              .resolveTable({
                knowledgeBaseId: props.knowledgeBaseId,
                ids: nextIds
              })
              .then((result) => {
                if (!result.ok) {
                  mounted.update({
                    notes: [],
                    missingIds: [],
                    error: result.error.message || '无法解析笔记表格'
                  })
                  return
                }
                mounted.update({
                  notes: result.value.notes.map((row) => ({
                    id: row.id,
                    title: row.title,
                    description: row.description,
                    url: row.noteUuid ? `desk-note://${encodeURIComponent(row.noteUuid)}` : '#'
                  })),
                  missingIds: result.value.missingIds,
                  error: null
                })
              })
              .catch((cause: unknown) => {
                mounted.update({
                  notes: [],
                  missingIds: [],
                  error: cause instanceof Error ? cause.message : String(cause)
                })
              })
          }

          applyNotesTableIds(ids)
          cleanupTasks.push(
            attachRawSourceEditor({
              dom,
              source: block.source,
              view,
              getPos,
              label: '编辑笔记表格',
              structuredNotesTable: true,
              renderPreview: (source) => {
                const next = parseNotesTableSource(source)
                applyNotesTableIds(next?.ids ?? [])
              }
            })
          )
        } else {
          const labelEl = dom.querySelector<HTMLElement>('.desk-raw-block__label')
          const previewEl = dom.querySelector<HTMLElement>('.desk-raw-block__preview')
          cleanupTasks.push(
            attachRawSourceEditor({
              dom,
              source: block.source,
              view,
              getPos,
              label: '编辑组件源码',
              renderPreview: (source) => {
                // 组件无专用可视化预览：刷新卡片标签/预览两行。
                const name = source.match(/^ {0,3}<([A-Z][\w.-]*)/)?.[1]
                if (labelEl) {
                  labelEl.textContent = name ? `组件 · ${name}` : '组件'
                }
                if (previewEl) {
                  const firstLine = source.split(/\r?\n/, 1)[0].trim()
                  previewEl.textContent =
                    firstLine.length <= 96 ? firstLine : `${firstLine.slice(0, 93)}…`
                }
              }
            })
          )
        }
      }
      if (block.kind === 'raw-diagram') {
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
            if (isEffectivelyReadOnly()) return
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
            attachRawSourceEditor({
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
            })
          )
        } else if (fence.lang === 'mindmap') {
          dom.classList.remove('desk-raw-block--diagram')
          dom.classList.add('desk-raw-block--mindmap')
          if (!isEffectivelyReadOnly()) {
            dom.classList.add('desk-raw-block--mindmap-editable')
          }
          dom.replaceChildren()
          const previewHost = document.createElement('div')
          previewHost.className = 'desk-raw-block__component-preview'
          dom.append(previewHost)

          let currentSource = block.source
          let writingBack = false
          const preview = mindmapPreviewMarkdown(currentSource)
          const editable = !isEffectivelyReadOnly()

          const resolveMindmapImage = (src: string): string =>
            resolveMarkdownImageUrl(src, props.knowledgeBaseId, props.noteUuid) || src

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
              blob instanceof File
                ? blob
                : new File([blob], `paste-${Date.now()}.${ext}`, { type })
            const uploaded = await props.uploadImage(file)
            return {
              relativePath: uploaded.src,
              alt: uploaded.alt
            }
          }

          const writeFence = (nextSource: string): void => {
            if (isEffectivelyReadOnly()) return
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
                  '.mindmap-preview-actions, .mindmap-preview-tabs, .mindmap-preview-action, [data-view-tab], .focus-breadcrumbs, .focus-crumb, .focus-sibling-menu',
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
          const editorCleanup = attachRawSourceEditor({
            dom,
            source: block.source,
            view,
            getPos,
            label: '编辑图表源码',
            renderPreview: renderInto
          })
          cleanupTasks.push(() => {
            editorCleanup()
            currentDiagram?.destroy?.()
          })
        }
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
          if (target?.closest('.desk-raw-block__editor, .desk-raw-block__include-cm, .desk-code-tab'))
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
          if (
            event.type === 'paste' &&
            target?.closest('.desk-raw-block--mindmap-editable')
          ) {
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
    })
  )
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
    // Prefer GitHub / TNotes style list markers (`-`) over remark's default `*`.
    ctx.update(remarkStringifyOptionsCtx, (current) => ({
      ...current,
      bullet: '-' as const,
      bulletOther: '*' as const
    }))
    ctx.update(uploadConfig.key, (current) => ({
      ...current,
      enableHtmlFileUploader: true,
      // Milkdown's upload plugin keeps a mapped placeholder in the document,
      // so edits made while the image uploads cannot stale the insertion point.
      uploader: async (files, schema) => {
        if (isEffectivelyReadOnly()) return []
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
    applyReadonlyState()
    if (host.value) {
      blockHandleClickCleanup = installBlockHandleClickController({
        root: host.value,
        getView: editorView,
        onClick: openBlockActionMenu
      })
      document.addEventListener('pointerdown', handleBlockMenuOutsidePointer, {
        capture: true
      })
      document.addEventListener('pointerup', handleBlockMenuDocumentPointerUp, {
        capture: true
      })
    }
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
  () => applyReadonlyState()
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
  slashMenuPresentationCleanup?.()
  slashMenuPresentationCleanup = null
  blockHandleClickCleanup?.()
  blockHandleClickCleanup = null
  document.removeEventListener('pointerdown', handleBlockMenuOutsidePointer, {
    capture: true
  })
  document.removeEventListener('pointerup', handleBlockMenuDocumentPointerUp, {
    capture: true
  })
  closeBlockActionMenu(false)
  const editor = crepe
  crepe = null
  if (editor) void editor.destroy()
})
</script>

<template>
  <div
    ref="host"
    class="milkdown-markdown-editor"
    :class="{ 'is-readonly': isEffectivelyReadOnly() }"
    @click.capture="handleClick"
  />
  <Teleport to="body">
    <BlockActionMenu
      v-if="blockActionMenu"
      :x="blockActionMenu.x"
      :y="blockActionMenu.y"
      @action="handleBlockAction"
      @add-below="openAddBelowMenu"
      @close="closeBlockActionMenu"
    />
  </Teleport>
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
  /* Size the document against the editor pane, not the window — sidebars
     commonly leave a narrow writing column even on a wide display. */
  container-type: inline-size;
  container-name: desk-visual-editor;
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
  --prosemirror-virtual-cursor-color: var(--accent-strong);
  --crepe-shadow-1: 0 6px 18px rgba(0, 0, 0, 0.28);
  --crepe-shadow-2: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-toolbar) {
  background: var(--raised);
  border: 1px solid var(--border);
  box-shadow: var(--crepe-shadow-1);
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-toolbar .toolbar-item svg) {
  color: var(--editor-text);
  fill: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-toolbar .toolbar-item:hover svg) {
  color: var(--text);
  fill: var(--text);
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-toolbar .toolbar-item.active svg) {
  color: var(--accent-strong);
  fill: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-block-handle .operation-item svg) {
  color: var(--editor-text);
  fill: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-block-handle .operation-item:hover svg),
.milkdown-markdown-editor :deep(.milkdown .milkdown-block-handle .operation-item.active svg) {
  color: var(--accent-strong);
  fill: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu) {
  width: min(340px, calc(100vw - 16px));
  container-type: inline-size;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .tab-group) {
  padding: 6px 8px 0;
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .tab-group ul) {
  gap: 3px;
  padding: 3px 2px 6px;
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .tab-group li) {
  flex: 1 1 auto;
  padding: 4px 7px;
  text-align: center;
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .menu-groups) {
  padding: 2px 8px 8px;
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .menu-group h6) {
  padding: 8px 6px 5px;
  font-size: 11px;
  line-height: 16px;
}

.milkdown-markdown-editor
  :deep(.milkdown .milkdown-slash-menu .menu-group[data-layout='compact-grid'] ul) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 4px;
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .menu-group li) {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  box-sizing: border-box;
  min-width: 0;
  gap: 8px;
  padding: 7px 8px;
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .menu-group li svg) {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  color: var(--editor-text);
  fill: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .menu-group li:hover svg),
.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .menu-group li.hover svg),
.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .menu-group li.active svg) {
  color: var(--accent-strong);
  fill: var(--accent-strong);
}

.milkdown-markdown-editor
  :deep(.milkdown .milkdown-slash-menu .menu-group li svg.desk-tnotes-icon) {
  color: var(--accent-strong);
  fill: none !important;
  stroke: currentColor;
}

.milkdown-markdown-editor
  :deep(.milkdown .milkdown-slash-menu .menu-group li > span:not(.milkdown-icon)) {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .desk-slash-menu__shortcut) {
  min-width: max-content;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 18px;
  white-space: nowrap;
}

.milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .menu-group + .menu-group::before) {
  margin: 4px 6px 0;
}

@media (max-width: 720px) {
  .milkdown-markdown-editor
    :deep(.milkdown .milkdown-slash-menu .menu-group[data-layout='compact-grid'] ul) {
    grid-template-columns: minmax(0, 1fr);
  }
}

@container (max-width: 310px) {
  .milkdown-markdown-editor
    :deep(.milkdown .milkdown-slash-menu .menu-group[data-layout='compact-grid'] ul) {
    grid-template-columns: minmax(0, 1fr);
  }

  .milkdown-markdown-editor :deep(.milkdown .milkdown-slash-menu .desk-slash-menu__shortcut) {
    display: none;
  }
}

.milkdown-markdown-editor :deep(.ProseMirror) {
  box-sizing: border-box;
  width: min(100%, 940px);
  min-height: 100%;
  margin: 0 auto;
  /* Left gutter must fit Crepe's block handle (2×32px icons + gap + 16px
     floating offset). Right matches for a balanced writing column. */
  padding: 28px 72px 48px 96px;
  line-height: 1.72;
  outline: none;
  --prosemirror-virtual-cursor-color: var(--accent-strong);
}

/* Crepe's virtual cursor owns text-caret rendering. Prefer it over the browser
   caret when the virtual-cursor implementation is present. */
.milkdown-markdown-editor:not(.is-readonly)
  :deep(.ProseMirror:not(.virtual-cursor-enabled):not(.ProseMirror-hideselection)) {
  caret-color: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.ProseMirror.virtual-cursor-enabled),
.milkdown-markdown-editor :deep(.ProseMirror.ProseMirror-hideselection) {
  caret-color: transparent;
}

/*
 * Dual-focus fix: while a block owns focus or is node-selected, hide the body
 * virtual caret (prosemirror-virtual-cursor keeps painting TextSelection even
 * after DOM focus moves into a nodeView island).
 */
.milkdown-markdown-editor:has(.desk-raw-block:focus-within) :deep(.prosemirror-virtual-cursor),
.milkdown-markdown-editor:has(.desk-raw-block.ProseMirror-selectednode)
  :deep(.prosemirror-virtual-cursor),
.milkdown-markdown-editor:has(.desk-raw-block.is-mindmap-island-active)
  :deep(.prosemirror-virtual-cursor),
.milkdown-markdown-editor:has(.milkdown-code-block:focus-within)
  :deep(.prosemirror-virtual-cursor),
.milkdown-markdown-editor:has(.milkdown-code-block.ProseMirror-selectednode)
  :deep(.prosemirror-virtual-cursor),
.milkdown-markdown-editor:has(.desk-raw-block:focus-within) :deep(.ProseMirror-gapcursor),
.milkdown-markdown-editor:has(.desk-raw-block.ProseMirror-selectednode)
  :deep(.ProseMirror-gapcursor),
.milkdown-markdown-editor:has(.desk-raw-block.is-mindmap-island-active)
  :deep(.ProseMirror-gapcursor) {
  opacity: 0 !important;
  visibility: hidden !important;
}

.milkdown-markdown-editor :deep(.ProseMirror > :first-child) {
  margin-top: 0;
}

/* VitePress .vp-doc headings + core `margin: 1rem 0` (tn:dev / published).
   Use px so Crepe’s 15px base does not inflate em sizes. Skip VP’s leftover
   h2 padding-top: 24px — core already tightened spacing. */
.milkdown-markdown-editor :deep(.ProseMirror h1:not(.desk-generated-title)),
.milkdown-markdown-editor :deep(.ProseMirror h2),
.milkdown-markdown-editor :deep(.ProseMirror h3),
.milkdown-markdown-editor :deep(.ProseMirror h4),
.milkdown-markdown-editor :deep(.ProseMirror h5),
.milkdown-markdown-editor :deep(.ProseMirror h6) {
  margin: 16px 0;
  padding: 0;
  border-top: none;
  font-weight: 600;
  /* Reserve selection chrome: Crepe paints background on selectednode which
     reads as a pop; keep box model identical and select via outline color only. */
  background-color: transparent;
  outline: 2px solid transparent;
  outline-offset: 0;
  scroll-margin: 0;
}

.milkdown-markdown-editor :deep(.ProseMirror h1:not(.desk-generated-title).ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.ProseMirror h2.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.ProseMirror h3.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.ProseMirror h4.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.ProseMirror h5.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.ProseMirror h6.ProseMirror-selectednode) {
  /* Beat Crepe `.ProseMirror-selectednode { background; outline: none }`. */
  background-color: transparent;
  outline: 2px solid var(--accent-strong);
  outline-offset: 0;
}


.milkdown-markdown-editor :deep(.ProseMirror h1) {
  font-size: 32px;
  line-height: 40px;
  letter-spacing: -0.02em;
}

.milkdown-markdown-editor :deep(.ProseMirror h2) {
  font-size: 24px;
  line-height: 32px;
  letter-spacing: -0.02em;
}

.milkdown-markdown-editor :deep(.ProseMirror h3) {
  font-size: 20px;
  line-height: 28px;
  letter-spacing: -0.01em;
}

.milkdown-markdown-editor :deep(.ProseMirror h4) {
  font-size: 18px;
  line-height: 24px;
  letter-spacing: -0.01em;
}

.milkdown-markdown-editor :deep(.ProseMirror h5),
.milkdown-markdown-editor :deep(.ProseMirror h6) {
  font-size: 16px;
  line-height: 24px;
  letter-spacing: normal;
}

.milkdown-markdown-editor :deep(.ProseMirror > h1:first-of-type),
.milkdown-markdown-editor :deep(.ProseMirror > h2:first-of-type),
.milkdown-markdown-editor :deep(.ProseMirror > h3:first-of-type),
.milkdown-markdown-editor :deep(.ProseMirror > h4:first-of-type),
.milkdown-markdown-editor :deep(.ProseMirror > h5:first-of-type),
.milkdown-markdown-editor :deep(.ProseMirror > h6:first-of-type),
.milkdown-markdown-editor :deep(.milkdown .ProseMirror h1.desk-generated-title) {
  /* Beat Crepe `.milkdown .ProseMirror h1 { margin-top: 32px }` and the
     general Desk `h1 { margin: 16px 0 }` so lead-in top margin never flips
     when virtual-cursor precedes the title (:first-child unstable). */
  margin-top: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block) {
  position: relative;
  display: flex;
  flex-wrap: wrap;
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

.milkdown-markdown-editor :deep(.desk-raw-block.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.desk-raw-block.desk-raw-block--range-selected) {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 1px var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block.desk-raw-block--range-selected) {
  background: color-mix(in srgb, var(--accent) 9%, var(--panel));
}

.milkdown-markdown-editor :deep(.desk-raw-block--container.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.desk-raw-block--container.desk-raw-block--range-selected) {
  border: none;
  box-shadow: none;
  background: transparent;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container.ProseMirror-selectednode > .custom-block),
.milkdown-markdown-editor
  :deep(.desk-raw-block--container.desk-raw-block--range-selected > .custom-block) {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 1px var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block__boundary-hit) {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 3;
  height: 10px;
  cursor: pointer;
}

.milkdown-markdown-editor :deep(.desk-raw-block__boundary-hit[data-side='before']) {
  top: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block__boundary-hit[data-side='after']) {
  bottom: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block--hidden) {
  display: none;
}

.milkdown-markdown-editor.is-readonly :deep(.ProseMirror) {
  caret-color: transparent !important;
  --prosemirror-virtual-cursor-color: transparent;
}

.milkdown-markdown-editor.is-readonly :deep(.prosemirror-virtual-cursor),
.milkdown-markdown-editor.is-readonly :deep(.ProseMirror-gapcursor),
.milkdown-markdown-editor.is-readonly :deep(.crepe-drop-cursor),
.milkdown-markdown-editor.is-readonly :deep(.milkdown-toolbar),
.milkdown-markdown-editor.is-readonly :deep(.milkdown-block-handle),
.milkdown-markdown-editor.is-readonly :deep(.milkdown-slash-menu),
.milkdown-markdown-editor.is-readonly :deep(.desk-raw-block__edit),
.milkdown-markdown-editor.is-readonly :deep(.desk-raw-block__editor) {
  display: none !important;
}

.milkdown-markdown-editor.is-readonly :deep(.ProseMirror-selectednode) {
  outline: 0;
  box-shadow: none;
}

.milkdown-markdown-editor :deep(.milkdown .crepe-drop-cursor) {
  background: var(--accent-strong);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-strong) 55%, transparent);
  opacity: 1;
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

.milkdown-markdown-editor :deep(.desk-raw-block--container) {
  position: relative;
  display: block;
  margin: 12px 0;
  padding: 0;
  min-height: 0;
  overflow: visible;
  border: none;
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: default;
}

.milkdown-markdown-editor :deep(.desk-raw-block--bilibili-video) {
  position: relative;
  display: block;
  margin: 12px 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: default;
}

.milkdown-markdown-editor :deep(.desk-raw-block--bilibili-video .desk-raw-block__component-preview) {
  min-height: 120px;
}

/* Match built-in code: no panel fill; border only on hover / focus / editing. */
.milkdown-markdown-editor :deep(.desk-raw-block--word-list) {
  position: relative;
  display: block;
  margin: 12px 0;
  padding: 0;
  overflow: visible;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  transition: border-color 120ms ease;
  cursor: default;
}

.milkdown-markdown-editor :deep(.desk-raw-block--word-list:hover),
.milkdown-markdown-editor :deep(.desk-raw-block--word-list:focus-within),
.milkdown-markdown-editor
  :deep(.desk-raw-block--word-list:has(.desk-raw-block__editor:not([hidden]))) {
  border-color: var(--border);
}

.milkdown-markdown-editor :deep(.desk-raw-block--word-list .desk-raw-block__component-preview) {
  min-height: 48px;
  padding: 4px 8px;
}

.milkdown-markdown-editor :deep(.desk-raw-block--bilibili-video.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.desk-raw-block--bilibili-video.desk-raw-block--range-selected) {
  outline: 2px solid var(--accent-strong);
  outline-offset: 2px;
}

.milkdown-markdown-editor :deep(.desk-raw-block--word-list.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.desk-raw-block--word-list.desk-raw-block--range-selected) {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 1px var(--accent-strong);
  background: transparent;
  outline: none;
}

/* Mermaid: same shell model as WordList — one border wraps preview + editor. */
.milkdown-markdown-editor :deep(.desk-raw-block--mermaid),
.milkdown-markdown-editor :deep(.desk-raw-block--mermaid.desk-raw-block--diagram) {
  position: relative;
  display: block;
  margin: 12px 0;
  padding: 0;
  min-height: 0;
  overflow: visible;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  transition: border-color 120ms ease;
  cursor: default;
}

.milkdown-markdown-editor :deep(.desk-raw-block--mermaid:hover),
.milkdown-markdown-editor :deep(.desk-raw-block--mermaid:focus-within),
.milkdown-markdown-editor
  :deep(.desk-raw-block--mermaid:has(.desk-raw-block__editor:not([hidden]))) {
  border-color: var(--border);
}

.milkdown-markdown-editor :deep(.desk-raw-block--mermaid .tn-mermaid) {
  margin: 0;
  border-color: transparent;
  border-radius: 0;
  background: transparent;
}

/* Shell hover/focus should reveal Mermaid actions even when the pointer is on the editor. */
.milkdown-markdown-editor :deep(.desk-raw-block--mermaid:hover .tn-mermaid__actions:not(.is-suppressed)),
.milkdown-markdown-editor
  :deep(.desk-raw-block--mermaid:focus-within .tn-mermaid__actions:not(.is-suppressed)) {
  opacity: 1;
}

.milkdown-markdown-editor :deep(.desk-raw-block--mermaid.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.desk-raw-block--mermaid.desk-raw-block--range-selected) {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 1px var(--accent-strong);
  outline: none;
  background: transparent;
}

/* Structured editor sits inside the shell — no second outer frame. */
.milkdown-markdown-editor
  :deep(.desk-raw-block--mermaid > .desk-raw-block__editor--structured),
.milkdown-markdown-editor
  :deep(.desk-raw-block--word-list > .desk-raw-block__editor--structured),
.milkdown-markdown-editor
  :deep(.desk-raw-block--mindmap > .desk-raw-block__editor--structured),
.milkdown-markdown-editor
  :deep(.desk-raw-block--notes-table > .desk-raw-block__editor--structured),
.milkdown-markdown-editor
  :deep(.desk-raw-block--footprints > .desk-raw-block__editor--structured) {
  margin-top: 0;
  border: 0;
  border-top: 1px solid var(--border);
  border-radius: 0 0 7px 7px;
  background: transparent;
}

.milkdown-markdown-editor :deep(.desk-raw-block--include) {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-items: stretch;
  align-self: stretch;
  width: 100%;
  gap: 8px;
  padding: 10px 12px;
  overflow: visible;
}

.milkdown-markdown-editor :deep(.desk-raw-block--include .desk-raw-block__label) {
  flex: 0 0 auto;
  align-self: flex-start;
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-body) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-pre) {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  max-height: 420px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--panel) 70%, var(--editor-bg));
  color: var(--editor-text);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  text-align: left;
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-toolbar) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-action) {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--editor-text);
  font-size: 12px;
  cursor: pointer;
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-action:hover:not(:disabled)) {
  border-color: var(--accent-strong);
  color: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-action:disabled) {
  opacity: 0.45;
  cursor: default;
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-action.is-dirty) {
  border-color: var(--accent-strong);
  background: color-mix(in srgb, var(--accent) 14%, var(--panel));
  color: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-cm) {
  min-height: 160px;
  max-height: 480px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--editor-bg);
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-cm .cm-editor) {
  min-height: 160px;
  background: var(--editor-bg) !important;
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-cm .cm-scroller),
.milkdown-markdown-editor :deep(.desk-raw-block__include-cm .cm-content),
.milkdown-markdown-editor :deep(.desk-raw-block__include-cm .cm-gutters),
.milkdown-markdown-editor :deep(.desk-raw-block__include-cm .cm-gutterElement),
.milkdown-markdown-editor :deep(.desk-raw-block__include-cm .cm-activeLine),
.milkdown-markdown-editor :deep(.desk-raw-block__include-cm .cm-activeLineGutter) {
  background-color: var(--editor-bg) !important;
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-cm .cm-gutters) {
  border-right: 1px solid var(--border);
  color: var(--muted);
}

.milkdown-markdown-editor :deep(.desk-raw-block--include.is-include-dirty) {
  border-color: color-mix(in srgb, var(--accent-strong) 55%, var(--border));
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-status) {
  min-height: 1.2em;
  color: var(--muted);
  font-size: 12px;
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-status[data-kind='error']) {
  color: var(--danger, #e85d5d);
}

.milkdown-markdown-editor :deep(.desk-raw-block__include-status[data-kind='ok']) {
  color: var(--accent-strong);
}

/* Mindmap / NotesTable / Footprints: WordList-like transparent shell. */
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap),
.milkdown-markdown-editor :deep(.desk-raw-block--notes-table),
.milkdown-markdown-editor :deep(.desk-raw-block--footprints) {
  position: relative;
  display: block;
  margin: 12px 0;
  padding: 0;
  overflow: visible;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  transition: border-color 120ms ease;
  cursor: default;
}

.milkdown-markdown-editor :deep(.desk-raw-block--mindmap:hover),
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap:focus-within),
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap.is-mindmap-island-active),
.milkdown-markdown-editor
  :deep(.desk-raw-block--mindmap:has(.desk-raw-block__editor:not([hidden]))),
.milkdown-markdown-editor :deep(.desk-raw-block--notes-table:hover),
.milkdown-markdown-editor :deep(.desk-raw-block--notes-table:focus-within),
.milkdown-markdown-editor
  :deep(.desk-raw-block--notes-table:has(.desk-raw-block__editor:not([hidden]))),
.milkdown-markdown-editor :deep(.desk-raw-block--footprints:hover),
.milkdown-markdown-editor :deep(.desk-raw-block--footprints:focus-within),
.milkdown-markdown-editor
  :deep(.desk-raw-block--footprints:has(.desk-raw-block__editor:not([hidden]))) {
  border-color: var(--border);
}

/* Match ui NotesTable link chrome (PM/global `a` styles must not force underline). */
.milkdown-markdown-editor :deep(.desk-raw-block--notes-table .tn-notes-table__link) {
  color: var(--tn-c-brand);
  text-decoration: none;
  cursor: pointer;
}

.milkdown-markdown-editor :deep(.desk-raw-block--notes-table .tn-notes-table__link:hover) {
  text-decoration: underline;
}

.milkdown-markdown-editor :deep(.desk-raw-block--notes-table .tn-notes-table) {
  margin: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block--mindmap.is-mindmap-island-active) {
  border-color: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .mindmap-preview) {
  margin: 0;
}

/* Escape editor scroll/containment so CSS fullscreen covers the Desk window. */
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .mindmap-preview.is-fullscreen) {
  position: fixed !important;
  inset: 0 !important;
  z-index: 200000 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  border-radius: 0 !important;
}

/* ProseMirror virtual-cursor sets caret-color: transparent on the whole doc —
   restore carets inside the mindmap island (canvas / outline / source). */
.milkdown-markdown-editor
  :deep(.desk-raw-block--mindmap .mm-edit-input),
.milkdown-markdown-editor
  :deep(.desk-raw-block--mindmap .rich-inline-editor),
.milkdown-markdown-editor
  :deep(.desk-raw-block--mindmap .md-textarea),
.milkdown-markdown-editor
  :deep(.desk-raw-block--mindmap .markdown-view textarea),
.milkdown-markdown-editor
  :deep(.desk-raw-block--mindmap [contenteditable='true']) {
  caret-color: var(--accent-strong, #3b82f6) !important;
}

.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .mm-selection-box) {
  border: 1px solid color-mix(in srgb, var(--accent-strong, #3b82f6) 88%, white);
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent-strong, #3b82f6) 16%, transparent);
}

.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .mindmap-preview-actions) {
  z-index: 200;
}

.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .mindmap-preview.is-fullscreen .mindmap-preview-actions) {
  pointer-events: auto !important;
  opacity: 1 !important;
}

.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .mm-editor) {
  outline: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--diagram) {
  position: relative;
  display: block;
  margin: 12px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  overflow: hidden;
  cursor: default;
}

.milkdown-markdown-editor :deep(.desk-raw-block--diagram .desk-diagram) {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  padding: 16px;
  overflow: auto;
}

.milkdown-markdown-editor :deep(.desk-raw-block--diagram .desk-diagram:has(.desk-diagram__empty)) {
  min-height: 88px;
}

.milkdown-markdown-editor :deep(.desk-raw-block--diagram .desk-diagram__svg svg) {
  max-width: 100%;
  height: auto;
}

.milkdown-markdown-editor :deep(.desk-raw-block--diagram .desk-diagram__mindmap) {
  position: relative;
  width: 100%;
  height: 320px;
  overflow: hidden;
}

.milkdown-markdown-editor :deep(.desk-raw-block--diagram .desk-diagram__error),
.milkdown-markdown-editor :deep(.desk-raw-block--diagram .desk-diagram__fallback),
.milkdown-markdown-editor :deep(.desk-raw-block--diagram .desk-diagram__empty) {
  color: var(--muted);
  font-size: 13px;
}

.milkdown-markdown-editor :deep(.desk-raw-block--diagram .desk-diagram__error) {
  color: var(--danger);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block) {
  box-sizing: border-box;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--editor-text);
}

/* Soft-tint callouts. Body typography matches Crepe ProseMirror paragraphs
   (line-height 1.5 + 4px vertical padding), not the editor chrome 1.72. */
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-tip),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-info),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-note),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-warning),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-danger),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-details) {
  padding: 12px 16px;
  font-size: inherit;
  line-height: 1.5;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-title) {
  margin: 0 0 2px;
  font-size: inherit;
  font-weight: 600;
  line-height: 1.5;
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body) {
  color: var(--editor-text);
  font-size: inherit;
  line-height: 1.5;
  /* ProseMirror uses break-spaces; markdown-it HTML has newlines between
     tags. Without normal whitespace those text nodes become ~22.5px line
     boxes and roughly double tip/info list height (li sum 62 → ul 128). */
  white-space: normal;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body > :first-child) {
  margin-top: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body > :last-child) {
  margin-bottom: 0;
}

/* tip → brand soft (VitePress --vp-c-tip-soft) */
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-tip) {
  background-color: var(--selected);
}

/* info / note / details → gray soft (VitePress --vp-c-default-soft) */
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-info),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-note),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-details) {
  background-color: var(--hover);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-warning) {
  background-color: var(--warning-soft);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-danger) {
  background-color: var(--danger-soft);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-code-group) {
  /* No outer panel chrome — tabs + inner code block carry the surface. */
  padding: 0;
  border: none;
  background: transparent;
}

/* Swiper — align with core `.tn-swiper` (tokenized for Desk). */
.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-swiper) {
  margin: 0;
  overflow: visible;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.18);
  background: transparent;
  padding: 0;
  border: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-swiper:hover) {
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.28);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-swiper-tabs) {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--border);
  border-radius: 8px 8px 0 0;
  background: var(--panel);
  box-shadow: inset 0 -1px var(--border);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-swiper-tabs.is-reordering) {
  overflow: visible;
  user-select: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab-nav) {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  padding: 0 0.3rem;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.8rem;
  line-height: 1;
  user-select: none;
  transition: color 0.2s ease, transform 0.2s ease, font-size 0.2s ease;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab-prev) {
  left: 0.5rem;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tab-tab-line) {
  left: 1.1rem;
  color: var(--accent-strong);
  cursor: default;
  opacity: 0.5;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab-next) {
  left: 1.5rem;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab-prev:hover),
.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab-next:hover) {
  color: var(--accent-strong);
  font-size: 1rem;
  transform: translateY(-50%) scale(1.5);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab-nav:active) {
  transform: translateY(-50%) scale(0.95);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab) {
  position: relative;
  flex: none;
  padding: 0.25rem 0.75rem;
  border: 0;
  border-bottom: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.875rem;
  line-height: 2rem;
  white-space: nowrap;
  transition: color 0.2s ease, transform 0.2s ease;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .desk-raw-block--swiper-editable .tn-tab) {
  cursor: grab;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab::after) {
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  z-index: 1;
  height: 2px;
  border-radius: 2px;
  content: '';
  background-color: transparent;
  transition: background-color 0.2s ease;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab:hover) {
  color: var(--editor-text);
  transform: translateY(-1px);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab.active) {
  color: var(--editor-text);
  font-weight: 500;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab.active::after) {
  background-color: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab.is-dragging) {
  z-index: 5;
  cursor: grabbing;
  opacity: 0.92;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .tn-tab__rename) {
  width: min(12rem, 40vw);
  margin: 0;
  padding: 2px 6px;
  border: 1px solid var(--accent-strong);
  border-radius: 4px;
  background: var(--editor-bg);
  color: var(--editor-text);
  /* Nested under ProseMirror.virtual-cursor-enabled which sets caret-color:
     transparent — restore a visible caret for this native input. */
  caret-color: var(--accent-strong);
  font: inherit;
  font-size: 0.875rem;
  line-height: 1.6rem;
  outline: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .swiper-container) {
  position: relative;
  width: 100%;
  overflow: hidden;
  margin: 0;
  border-radius: 0 0 8px 8px;
  background: var(--editor-bg);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .swiper-slide) {
  display: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .swiper-slide.is-active) {
  display: block;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .swiper-slide img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
  object-fit: contain;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container details.custom-block-details > summary) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block--container details.custom-block-details > summary::-webkit-details-marker) {
  display: none;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block--container details.custom-block-details > summary::before) {
  content: '';
  flex: none;
  box-sizing: border-box;
  width: 0.42em;
  height: 0.42em;
  margin-top: 0.05em;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  color: var(--muted);
  transform: rotate(-45deg);
  transform-origin: 50% 50%;
  transition: transform 120ms ease;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block--container details.custom-block-details[open] > summary::before) {
  margin-top: -0.05em;
  transform: rotate(45deg);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container details:not([open]) > *:not(summary)) {
  display: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body p) {
  margin: 0;
  padding: 4px 0;
  font-size: 1em;
  line-height: 1.5;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body p:last-child) {
  margin-bottom: 0;
}

/* Callout body lists are markdown-it <ul>/<li>, while outer editor lists are
   Crepe milkdown-list-item-block (flex + 24×32 label + p padding 4px 0).
   Mirror that row geometry so tip/info lists match outer density. */
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body ul),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body ol) {
  margin: 0;
  padding: 0;
  font-size: 1em;
  line-height: 1.5;
  list-style: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body ol) {
  counter-reset: desk-callout-ol;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body li) {
  position: relative;
  box-sizing: border-box;
  margin: 0;
  /* 24px label + 10px gap — same as Crepe .label-wrapper + gap */
  padding: 0 0 0 34px;
  line-height: 1.5;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body ol > li) {
  counter-increment: desk-callout-ol;
}

/* Text-only items: same vertical rhythm as Crepe list <p>. */
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body li:not(:has(> p))) {
  padding-top: 4px;
  padding-bottom: 4px;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body li > p) {
  margin: 0;
  padding: 4px 0;
  line-height: 1.5;
}

/* Bullet / number column — matches Crepe .label-wrapper (24×32). */
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body ul > li::before),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body ol > li::before) {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: 24px;
  height: 32px;
  color: var(--muted);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body ul > li::before) {
  content: '';
  background: radial-gradient(circle, currentColor 3px, transparent 3.25px);
  background-position: center;
  background-repeat: no-repeat;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body ol > li::before) {
  content: counter(desk-callout-ol) '.';
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 4px 0;
  font-size: 1em;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body li > ul),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body li > ol) {
  margin: 0;
  padding: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body img) {
  max-width: 100%;
  height: auto;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body pre) {
  overflow-x: auto;
  white-space: pre-wrap;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tabs) {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  position: relative;
  user-select: none;
  touch-action: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tabs.is-reordering) {
  cursor: grabbing;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tab) {
  position: relative;
  padding: 4px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
  background: var(--hover);
  border: 1px solid var(--border);
  border-radius: 6px 6px 0 0;
  cursor: grab;
  transition: transform 120ms ease;
  will-change: transform;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tab:active) {
  cursor: grabbing;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tab:hover) {
  color: var(--editor-text);
  background: var(--raised);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tab.active) {
  color: var(--editor-text);
  background: var(--panel);
  border-color: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tab.is-tab-dirty) {
  color: var(--accent-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tab.is-dragging) {
  opacity: 0.92;
  z-index: 5;
  box-shadow: 0 4px 12px color-mix(in srgb, #000 28%, transparent);
  transition: none;
  cursor: grabbing;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tab__rename) {
  width: 100%;
  min-width: 48px;
  max-width: 160px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  caret-color: var(--accent-strong);
  font: inherit;
  line-height: inherit;
  outline: none;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block--container .desk-raw-block--code-group-editable .desk-raw-block__include-body) {
  gap: 0;
  padding: 0;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block--container .desk-raw-block--code-group-editable .code-group-panel) {
  padding: 0 0 8px;
}

.milkdown-markdown-editor :deep(.desk-code-tab) {
  position: relative;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--editor-bg);
  transition: border-color 120ms ease;
  overflow: visible;
  padding: 8px 12px 12px;
}

.milkdown-markdown-editor :deep(.desk-code-tab:hover),
.milkdown-markdown-editor :deep(.desk-code-tab:focus-within),
.milkdown-markdown-editor :deep(.desk-code-tab.is-dirty) {
  border-color: var(--border);
}

.milkdown-markdown-editor :deep(.desk-code-tab.is-dirty) {
  border-color: color-mix(in srgb, var(--accent-strong) 55%, var(--border));
}

/* Same tools chrome as standalone milkdown code blocks (header row, not overlay). */
.milkdown-markdown-editor :deep(.desk-code-tab.milkdown-code-block .tools.desk-code-tab__tools) {
  position: relative;
  top: auto;
  right: auto;
  z-index: 2;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-height: 28px;
  margin: 0 0 4px;
  padding: 0 2px;
  pointer-events: auto;
}

.milkdown-markdown-editor :deep(.desk-code-tab .tools .language-button),
.milkdown-markdown-editor :deep(.desk-code-tab:hover .tools .language-button),
.milkdown-markdown-editor :deep(.desk-code-tab .tools .tools-button-group button),
.milkdown-markdown-editor :deep(.desk-code-tab:hover .tools .tools-button-group button) {
  opacity: 1;
  margin-bottom: 0;
}

.milkdown-markdown-editor :deep(.desk-code-tab .tools .copy-button svg) {
  fill: currentColor;
  stroke: none;
}

.milkdown-markdown-editor :deep(.desk-code-tab .tools .copy-button svg path) {
  fill: currentColor;
}

.milkdown-markdown-editor :deep(.desk-code-tab .tools .language-button .expand-icon svg) {
  fill: none;
  stroke: currentColor;
}

.milkdown-markdown-editor :deep(.desk-code-tab__tools .language-picker) {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: auto;
}

.milkdown-markdown-editor :deep(.desk-code-tab__cm) {
  min-height: 140px;
  max-height: 480px;
  border: 0;
  border-radius: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-panels .code-group-panel) {
  display: none;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block--container .code-group-panels .code-group-panel.active) {
  display: block;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__edit) {
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 2;
  padding: 3px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__edit--pill) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  color: var(--editor-text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 100px;
  box-shadow: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__edit--pill svg) {
  width: 14px;
  height: 14px;
  fill: currentColor;
  flex: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block:hover .desk-raw-block__edit),
.milkdown-markdown-editor :deep(.desk-raw-block.ProseMirror-selectednode .desk-raw-block__edit),
.milkdown-markdown-editor :deep(.desk-raw-block:focus-within .desk-raw-block__edit) {
  opacity: 1;
}

/*
 * Generic edit rule is `.desk-raw-block .desk-raw-block__edit` (top/right).
 * Beat it with higher specificity so Mermaid edit shares the action-bar row
 * instead of sitting under the icon cluster (z-index 10 covers top:8px/right:10px).
 *
 * Action bar: top 8px, right 8px, ~96px wide (3×28 + gaps + padding).
 */
.milkdown-markdown-editor
  :deep(.desk-raw-block.desk-raw-block--mermaid > .desk-raw-block__edit) {
  top: 10px;
  right: 112px;
  z-index: 11;
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__edit:hover),
.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__edit--pill:hover) {
  color: var(--text, var(--editor-text));
  background: var(--hover);
  border-color: var(--border);
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor) {
  flex: 0 0 100%;
  width: 100%;
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--editor-bg);
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor--structured) {
  position: relative;
  overflow: visible;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-label) {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-done) {
  padding: 3px 12px;
  font-size: 12px;
  color: var(--editor-bg);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 6px;
  cursor: pointer;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-done:hover) {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured > .desk-raw-block__editor-done) {
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 3;
  opacity: 1;
  color: var(--editor-text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 100px;
  box-shadow: none;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured > .desk-raw-block__editor-done:hover) {
  color: var(--text, var(--editor-text));
  background: var(--hover);
  border-color: var(--border);
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured .desk-raw-block__editor-fields) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 8px;
  background: var(--editor-bg);
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured .desk-raw-block__editor-title) {
  width: 100%;
  margin: 0;
  padding: 10px 88px 10px 12px;
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  color: var(--editor-text);
  caret-color: var(--accent-strong);
  background: transparent;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 0;
  outline: none;
  user-select: text;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured .desk-raw-block__editor-title::placeholder) {
  color: var(--muted);
  opacity: 0.85;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured .desk-raw-block__editor-toggles) {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  padding: 8px 12px 10px;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured .desk-raw-block__editor-toggle) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  line-height: 1.3;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured .desk-raw-block__editor-toggle input) {
  margin: 0;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured .desk-raw-block__editor-title:focus) {
  border-bottom-color: color-mix(in srgb, var(--accent-strong) 45%, var(--border));
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm) {
  height: var(--desk-raw-editor-height, 220px);
  overflow: hidden;
  background: var(--editor-bg);
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured .desk-raw-block__editor-cm) {
  border: 0;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor--structured .desk-raw-block__editor-cm .cm-placeholder) {
  color: var(--muted);
  opacity: 0.85;
  font-style: normal;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-editor) {
  height: 100%;
  background: var(--editor-bg) !important;
}

/* Override githubDark/Light panel colors so tip/Mermaid/WordList editors match the document. */
.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-scroller),
.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-content),
.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-gutters),
.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-gutterElement),
.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-activeLine),
.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-activeLineGutter) {
  background-color: var(--editor-bg) !important;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-gutters) {
  border-right: 1px solid var(--border);
  color: var(--muted);
}

.milkdown-markdown-editor :deep(.desk-generated-title) {
  /* Excluded from `.ProseMirror h1 { margin: 16px 0 }`; keep top stable so
     virtual-cursor / :first-child flips cannot change lead-in spacing. */
  margin-top: 0;
  margin-bottom: 16px;
  padding: 0;
  border: 0;
  font-size: 32px;
  font-weight: 600;
  line-height: 40px;
  letter-spacing: -0.02em;
  color: var(--editor-text);
  cursor: default;
  position: relative;
  /* Always reserve outline ink so NodeSelect only changes color. */
  outline: 2px solid transparent;
  outline-offset: 0;
  background-color: transparent;
}

.milkdown-markdown-editor :deep(.desk-generated-title a) {
  color: inherit;
  text-decoration: none;
}

.milkdown-markdown-editor :deep(.desk-generated-title.ProseMirror-selectednode) {
  /* Full shorthand beats Crepe's `.ProseMirror-selectednode { outline: none }`.
     Keep width/offset identical to the unselected transparent reserve.
     No background — avoids selected/unselected paint asymmetry. */
  outline: 2px solid var(--accent-strong);
  outline-offset: 0;
  background-color: transparent;
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
  border-top: 5px solid currentColor;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  transition: transform 120ms ease;
}

.milkdown-markdown-editor :deep(.desk-generated-toc.is-collapsed .desk-generated-toc__toggle-icon) {
  transform: rotate(-90deg);
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
  outline: none;
  box-shadow: none;
}

.milkdown-markdown-editor :deep(.desk-generated-toc::selection),
.milkdown-markdown-editor :deep(.desk-generated-toc *::selection),
.milkdown-markdown-editor :deep(.desk-generated-title::selection),
.milkdown-markdown-editor :deep(.desk-generated-title *::selection),
.milkdown-markdown-editor :deep(.desk-raw-block::selection),
.milkdown-markdown-editor :deep(.desk-raw-block *::selection) {
  background: transparent;
  color: inherit;
}

/* The raw-block inline source editor is a CodeMirror view; restore a visible
   selection highlight that the blanket `.desk-raw-block *::selection` above
   would otherwise wipe out. Prefer native ::selection (character-tight) over
   CodeMirror drawSelection full-line layers. */
.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-content::selection),
.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-content *::selection) {
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--editor-text);
}

.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-selectionBackground),
.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-editor.cm-focused .cm-selectionBackground) {
  background: transparent !important;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-title::selection) {
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--editor-text);
}

/* Tab rename inputs — same blanket wipe as above; restore visible text selection. */
.milkdown-markdown-editor :deep(.desk-raw-block .tn-tab__rename::selection),
.milkdown-markdown-editor :deep(.desk-raw-block .code-group-tab__rename::selection) {
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--editor-text);
}

/* Mindmap island editors — same blanket wipe as above; restore visible text selection. */
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .mm-edit-input::selection),
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .mm-edit-input *::selection),
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .rich-inline-editor::selection),
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .rich-inline-editor *::selection),
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .title-input::selection),
.milkdown-markdown-editor :deep(.desk-raw-block--mindmap .md-textarea::selection) {
  background: color-mix(in srgb, var(--accent-strong, var(--accent)) 55%, transparent);
  color: inherit;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .language-picker) {
  /* Anchor under the tools row (right side) so the 410px list is out of flow
     and does not push following markdown / grow scroll height. */
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: auto;
  z-index: 30;
  width: max-content;
  max-width: min(240px, 100%);
  padding-top: 0;
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .language-picker .list-wrapper) {
  background: var(--panel);
  color: var(--editor-text);
  right: 0;
  left: auto;
  max-height: min(410px, 55vh);
  overflow: hidden;
  box-shadow: var(--shadow, 0 8px 24px color-mix(in srgb, #000 28%, transparent));
}

.milkdown-markdown-editor :deep(.milkdown-code-block .language-picker .language-list) {
  height: auto;
  max-height: min(360px, 48vh);
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

.milkdown-markdown-editor :deep(.milkdown-code-block .tools) {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-height: 28px;
  margin-bottom: 4px;
  padding: 0 2px;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .desk-code-title) {
  order: 0;
  flex: 1 1 auto;
  min-width: 0;
  margin-right: auto;
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--editor-text);
  /* Nested under ProseMirror.virtual-cursor-enabled which sets caret-color:
     transparent — restore a visible caret for this native input. */
  caret-color: var(--accent-strong);
  font-size: 12px;
  font-weight: 500;
  line-height: 22px;
  outline: none;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .desk-code-title::placeholder) {
  color: var(--muted);
  opacity: 0.85;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .desk-code-title:focus) {
  background: color-mix(in srgb, var(--panel) 70%, transparent);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .tools-button-group) {
  /* Copy sits to the right of the language pill. */
  order: 3;
  gap: 4px;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .tools-button-group button) {
  background: color-mix(in srgb, var(--panel) 88%, var(--editor-bg));
  color: var(--muted);
  border: 1px solid var(--border);
  opacity: 1;
  border-radius: 4px;
  padding: 3px 8px;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .tools-button-group button:first-child),
.milkdown-markdown-editor :deep(.milkdown-code-block .tools .tools-button-group button:last-child) {
  border-radius: 4px;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .tools-button-group button[data-copied='true']) {
  color: var(--accent-strong);
  border-color: var(--accent-strong);
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
  overflow: visible;
}

.milkdown-markdown-editor :deep(.milkdown-code-block:hover) {
  border-color: var(--border);
}

.milkdown-markdown-editor :deep(.milkdown-code-block.ProseMirror-selectednode),
.milkdown-markdown-editor :deep(.milkdown-code-block.desk-code-block--whole-selected),
.milkdown-markdown-editor :deep(.milkdown-code-block.selected) {
  border-color: var(--accent-strong);
  box-shadow: 0 0 0 1px var(--accent-strong);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .cm-gutters) {
  background: var(--editor-bg);
  color: var(--muted);
  border-right: 1px solid var(--border);
}

/* Yuque-like language pill — left of Copy within the top-right cluster. */
.milkdown-markdown-editor :deep(.milkdown-code-block .tools .language-button),
.milkdown-markdown-editor :deep(.milkdown-code-block:hover .tools .language-button) {
  order: 2;
  opacity: 1;
  margin: 0;
  height: 22px;
  padding: 0 6px 0 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--panel) 88%, var(--editor-bg));
  color: var(--muted);
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  gap: 2px;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .language-button:hover) {
  background: var(--hover);
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .language-button .expand-icon) {
  width: 14px;
  height: 14px;
}

.milkdown-markdown-editor :deep(.milkdown-code-block .tools .language-button .expand-icon svg) {
  width: 12px;
  height: 12px;
  color: var(--muted);
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

@container desk-visual-editor (max-width: 640px) {
  .milkdown-markdown-editor :deep(.ProseMirror) {
    /* Keep a handle gutter even in a squeezed pane; never collapse to the
       content edge (the old 20px padding clipped + / drag controls). */
    padding: 22px 40px 40px 80px;
  }
}
</style>

<!-- Unscoped: hide non-fullscreen mindmap chrome while one owns the overlay. -->
<style>
html[data-tn-mindmap-fs] .mindmap-preview:not(.is-fullscreen) .mindmap-preview-actions,
body[data-tn-mindmap-fs] .mindmap-preview:not(.is-fullscreen) .mindmap-preview-actions {
  display: none !important;
  opacity: 0 !important;
  pointer-events: none !important;
  visibility: hidden !important;
}
</style>
