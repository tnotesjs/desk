<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx, commandsCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
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

import {
  projectRawBlocksForMilkdown,
  rawBlockProjectionPlugins,
  rawBlockSchema as deskRawBlockSchema,
  renderDeskRawBlockElement
} from '../editor/markdown/rawBlockProjection'
import type { ProjectedRawBlockKind } from '../editor/markdown/rawBlockProjection'
import { renderContainerFromSource } from '../editor/markdown/containerBody'
import {
  createContainerSourceEditor,
  type ContainerSourceEditorHandle
} from '../editor/markdown/containerSourceEditor'
import { renderDiagram } from '../editor/markdown/diagramRenderer'
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
  renderPreview: (source: string) => void
}

/**
 * Wires the "编辑源码" button + inline CodeMirror editor onto an editable raw
 * block (containers and diagrams). Live edits re-render the preview through
 * `renderPreview`; committing dispatches a source-updating transaction that is
 * reconciled byte-faithfully by sourcePreservation.
 */
function attachRawSourceEditor(ctx: RawSourceEditorContext): () => void {
  const editButton = document.createElement('button')
  editButton.type = 'button'
  editButton.className = 'desk-raw-block__edit'
  editButton.textContent = '编辑源码'
  const editorHost = document.createElement('div')
  editorHost.className = 'desk-raw-block__editor'
  editorHost.hidden = true
  ctx.dom.append(editButton, editorHost)

  let editorValue = ctx.source
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let editing = false
  let editorHandle: ContainerSourceEditorHandle | null = null

  const fitEditorToSource = (value: string): void => {
    const lines = value.split(/\r?\n/).length
    const height = Math.min(320, Math.max(132, lines * 22 + 56))
    editorHost.style.setProperty('--desk-raw-editor-height', `${height}px`)
  }

  const closeEditing = (): void => {
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
      if (editing) ctx.renderPreview(ctx.source)
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
    if (isEffectivelyReadOnly()) {
      applyReadonly(true)
      return
    }
    if (editorValue === ctx.source) {
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

  const startEditing = (): void => {
    if (editing || isEffectivelyReadOnly()) return
    editing = true
    editorValue = ctx.source
    fitEditorToSource(editorValue)
    editButton.hidden = true
    editButton.disabled = true

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

    const cmHost = document.createElement('div')
    cmHost.className = 'desk-raw-block__editor-cm'
    editorHost.replaceChildren()
    editorHost.append(header, cmHost)
    editorHost.hidden = false

    editorHandle = createContainerSourceEditor(
      cmHost,
      ctx.source,
      (value) => {
        if (isEffectivelyReadOnly()) return
        editorValue = value
        fitEditorToSource(value)
        if (syncTimer != null) clearTimeout(syncTimer)
        syncTimer = setTimeout(() => ctx.renderPreview(editorValue), 250)
      },
      () => commit()
    )
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
      if (!block.hidden) {
        cleanupTasks.push(attachRawBlockBoundaryControls({ dom, view, getPos }))
      }
      if (block.kind === 'raw-container') {
        let previewEl = dom.querySelector('.custom-block') as HTMLElement | null
        cleanupTasks.push(
          attachRawSourceEditor({
            dom,
            source: block.source,
            view,
            getPos,
            label: '编辑容器源码',
            renderPreview: (source) => {
              if (!previewEl) return
              const fresh = renderContainerFromSource(source, resolveImage)
              previewEl.replaceWith(fresh)
              previewEl = fresh
            }
          })
        )
      }
      if (block.kind === 'raw-component') {
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
      if (block.kind === 'raw-diagram') {
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
            // The canvas needs the host to be laid out (clientWidth/Height);
            // defer creation to the next frame so the size is available.
            const active = rendered.activate
            if (active) {
              // Defer past the first layout so the canvas host has real
              // clientWidth/Height; otherwise zoomToFit can't frame the tree.
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
      return {
        dom,
        update: (nextNode) => {
          if (nextNode.type.name !== 'deskRawBlock') return false
          // An external content sync may replace the atom entirely; remount then.
          if (nextNode.attrs.source !== node.attrs.source) return false
          return true
        },
        selectNode: () => dom.classList.add('ProseMirror-selectednode'),
        deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
        ignoreMutation: () => true,
        destroy: () => cleanupTasks.splice(0).forEach((cleanup) => cleanup()),
        stopEvent: (event) => {
          const target = event.target as Element | null
          // CodeMirror owns keyboard/input events inside the inline source
          // editor. Letting ProseMirror handle Meta+A or text input would select
          // and replace the surrounding atomic block.
          if (target?.closest('.desk-raw-block__editor-cm')) return true
          // Let native details toggles and links inside the rendered container
          // keep their default behaviour instead of being turned into a node
          // selection; everything else selects the atom so it stays swipeable.
          if (target?.closest('summary, a, button, textarea, .desk-raw-block__boundary-hit'))
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
      bullet: '-',
      bulletOther: '*'
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
  padding: 28px 40px 48px;
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

.milkdown-markdown-editor :deep(.ProseMirror > :first-child) {
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

.milkdown-markdown-editor
  :deep(.desk-raw-block.desk-raw-block--boundary-active.ProseMirror-selectednode) {
  border-color: var(--border);
  box-shadow: none;
  background: var(--panel);
}

.milkdown-markdown-editor :deep(.desk-raw-block__boundary-hit) {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 3;
  height: 10px;
  cursor: text;
}

.milkdown-markdown-editor :deep(.desk-raw-block__boundary-hit[data-side='before']) {
  top: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block__boundary-hit[data-side='after']) {
  bottom: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-boundary-cursor) {
  position: relative;
  display: block;
  width: 100%;
  height: 0;
  pointer-events: none;
}

.milkdown-markdown-editor :deep(.desk-raw-boundary-cursor::after) {
  position: absolute;
  left: 1px;
  top: -11px;
  width: 1px;
  height: 22px;
  border-radius: 1px;
  background: var(--accent-strong);
  content: '';
  animation: desk-raw-boundary-blink 1.1s steps(1, end) infinite;
}

@keyframes desk-raw-boundary-blink {
  0%,
  55% {
    opacity: 1;
  }
  56%,
  100% {
    opacity: 0;
  }
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
.milkdown-markdown-editor.is-readonly :deep(.desk-raw-boundary-cursor),
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

/* Desk owns the visible caret at raw-block boundaries. Hide Milkdown's
   virtual cursor and ProseMirror's horizontal gap bar in those states. */
.milkdown-markdown-editor
  :deep(.ProseMirror:has(.desk-raw-boundary-cursor) .prosemirror-virtual-cursor),
.milkdown-markdown-editor
  :deep(.ProseMirror:has(.desk-raw-boundary-cursor) .ProseMirror-gapcursor) {
  display: none;
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
  cursor: default;
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
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: 8px;
  background: var(--panel);
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-title) {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body) {
  color: var(--editor-text);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-tip) {
  border-left-color: var(--success);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-info),
.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-note) {
  border-left-color: var(--accent);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-warning) {
  border-left-color: var(--warning);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-danger) {
  border-left-color: var(--danger);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-details) {
  border-left-color: var(--border-strong);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container details summary) {
  cursor: pointer;
  list-style: none;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block--container details summary::-webkit-details-marker) {
  display: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container details summary::before) {
  content: '▸';
  display: inline-block;
  margin-right: 8px;
  color: var(--muted);
}

.milkdown-markdown-editor :deep(.desk-raw-block--container details[open] summary::before) {
  content: '▾';
}

.milkdown-markdown-editor :deep(.desk-raw-block--container details:not([open]) > *:not(summary)) {
  display: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body p) {
  margin: 0 0 8px;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body p:last-child) {
  margin-bottom: 0;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body img) {
  max-width: 100%;
  height: auto;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-body pre) {
  overflow-x: auto;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tabs) {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-tab) {
  padding: 4px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
  background: var(--hover);
  border: 1px solid var(--border);
  border-radius: 6px 6px 0 0;
  cursor: pointer;
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

.milkdown-markdown-editor :deep(.desk-raw-block--container .code-group-panels .code-group-panel) {
  display: none;
}

.milkdown-markdown-editor
  :deep(.desk-raw-block--container .code-group-panels .code-group-panel.active) {
  display: block;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-swiper .swiper-body) {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-swiper .swiper-body p) {
  margin: 0;
  flex: none;
}

.milkdown-markdown-editor :deep(.desk-raw-block--container .custom-block-swiper .swiper-body img) {
  display: block;
  max-height: 260px;
  width: auto;
  max-width: none;
  border: 1px solid var(--border);
  border-radius: 6px;
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

.milkdown-markdown-editor :deep(.desk-raw-block:hover .desk-raw-block__edit),
.milkdown-markdown-editor :deep(.desk-raw-block.ProseMirror-selectednode .desk-raw-block__edit) {
  opacity: 1;
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__edit:hover) {
  color: var(--editor-text);
  border-color: var(--accent-strong);
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

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm) {
  height: var(--desk-raw-editor-height, 220px);
  overflow: hidden;
  background: var(--editor-bg);
}

.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-editor) {
  height: 100%;
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
   would otherwise wipe out. */
.milkdown-markdown-editor :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-content::selection),
.milkdown-markdown-editor
  :deep(.desk-raw-block .desk-raw-block__editor-cm .cm-content *::selection) {
  background: var(--selected);
  color: var(--editor-text);
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
