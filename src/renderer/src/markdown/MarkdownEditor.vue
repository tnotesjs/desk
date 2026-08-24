<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection
} from '@codemirror/view'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'

import { externalDocumentSync, visualMarkdownExtensions } from './visualExtension'

import type { NoteViewMode } from '../../../shared/contracts'

const props = defineProps<{
  content: string
  mode: NoteViewMode
  readOnly: boolean
  knowledgeBaseId: string
  noteUuid: string
  active: boolean
}>()

const emit = defineEmits<{
  change: [content: string]
  openLink: [url: string]
  openNote: [noteUuid: string]
  pasteImage: [file: File, insertAt: number]
}>()

const host = ref<HTMLElement | null>(null)
const modeCompartment = new Compartment()
const editableCompartment = new Compartment()
let view: EditorView | null = null
let resizeObserver: ResizeObserver | null = null
let appearanceObserver: MutationObserver | null = null

function isEffectivelyReadOnly(): boolean {
  return props.readOnly || props.mode === 'readonly'
}

const turndown = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**'
})
turndown.remove(['script', 'style', 'form', 'object', 'embed'])

function openLink(url: string): void {
  emit('openLink', url)
}

function modeExtensions(): Extension[] {
  if (props.mode === 'source') {
    return [
      document.documentElement.dataset.theme === 'light' ? githubLight : githubDark,
      lineNumbers(),
      foldGutter(),
      highlightActiveLineGutter(),
      EditorView.editorAttributes.of({ class: 'cm-source-editor' })
    ]
  }
  return visualMarkdownExtensions(
    { knowledgeBaseId: props.knowledgeBaseId, noteUuid: props.noteUuid },
    openLink,
    { openNote: (noteUuid) => emit('openNote', noteUuid) },
    props.mode === 'visual' && !props.readOnly
  )
}

function editableExtensions(): Extension[] {
  const readOnly = isEffectivelyReadOnly()
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

function cleanHtmlToMarkdown(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'form', 'object', 'embed', 'iframe'],
    FORBID_ATTR: ['style', 'color', 'bgcolor', 'face']
  })
  return turndown.turndown(clean)
}

function handlePaste(event: ClipboardEvent, editorView: EditorView): boolean {
  const image = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .find((item): item is File => Boolean(item))
  if (image) {
    event.preventDefault()
    emit('pasteImage', image, editorView.state.selection.main.from)
    return true
  }
  if ((event as ClipboardEvent & { shiftKey?: boolean }).shiftKey) return false
  const html = event.clipboardData?.getData('text/html')
  if (!html) return false
  const markdownText = cleanHtmlToMarkdown(html)
  if (!markdownText) return false
  event.preventDefault()
  editorView.dispatch(editorView.state.replaceSelection(markdownText))
  return true
}

function insertTextAt(text: string, position?: number): void {
  if (!view || isEffectivelyReadOnly()) return
  const target = Math.max(
    0,
    Math.min(position ?? view.state.selection.main.from, view.state.doc.length)
  )
  view.dispatch({
    changes: { from: target, insert: text },
    selection: { anchor: target + text.length }
  })
  view.focus()
}

function wrapSelection(prefix: string, suffix: string, placeholder = '文字'): void {
  if (!view || isEffectivelyReadOnly()) return
  const range = view.state.selection.main
  const selected = view.state.sliceDoc(range.from, range.to) || placeholder
  const text = `${prefix}${selected}${suffix}`
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: {
      anchor: range.from + prefix.length,
      head: range.from + prefix.length + selected.length
    }
  })
  view.focus()
}

function prefixSelection(prefix: string): void {
  if (!view || isEffectivelyReadOnly()) return
  const range = view.state.selection.main
  const firstLine = view.state.doc.lineAt(range.from)
  const lastLine = view.state.doc.lineAt(range.to)
  const source = view.state.sliceDoc(firstLine.from, lastLine.to)
  const text = source
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
  view.dispatch({
    changes: { from: firstLine.from, to: lastLine.to, insert: text },
    selection: { anchor: firstLine.from, head: firstLine.from + text.length }
  })
  view.focus()
}

function setLinePrefix(prefix: string): void {
  if (!view || isEffectivelyReadOnly()) return
  const range = view.state.selection.main
  const firstLine = view.state.doc.lineAt(range.from)
  const lastLine = view.state.doc.lineAt(range.to)
  const source = view.state.sliceDoc(firstLine.from, lastLine.to)
  const lines = source.split('\n')
  const text = lines
    .map((line, index) => {
      const content = line.replace(
        /^\s{0,3}(?:#{1,6}\s+|>\s+|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/,
        ''
      )
      const resolvedPrefix = prefix === '1. ' ? `${index + 1}. ` : prefix
      return `${resolvedPrefix}${content}`
    })
    .join('\n')
  view.dispatch({
    changes: { from: firstLine.from, to: lastLine.to, insert: text },
    selection: { anchor: firstLine.from, head: firstLine.from + text.length }
  })
  view.focus()
}

function runEdit(action: () => void): boolean {
  if (isEffectivelyReadOnly()) return false
  action()
  return true
}

defineExpose({ insertTextAt, wrapSelection, prefixSelection, setLinePrefix })

function baseExtensions(): Extension[] {
  return [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    autocompletion(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown(),
    EditorState.allowMultipleSelections.of(true),
    keymap.of([
      {
        key: 'Mod-b',
        run: () => runEdit(() => wrapSelection('**', '**'))
      },
      {
        key: 'Mod-i',
        run: () => runEdit(() => wrapSelection('*', '*'))
      },
      {
        key: 'Mod-e',
        run: () => runEdit(() => wrapSelection('`', '`', '代码'))
      },
      {
        key: 'Shift-Mod-x',
        run: () => runEdit(() => wrapSelection('~~', '~~'))
      },
      {
        key: 'Shift-Mod-7',
        run: () => runEdit(() => setLinePrefix('1. '))
      },
      {
        key: 'Shift-Mod-8',
        run: () => runEdit(() => setLinePrefix('- '))
      },
      {
        key: 'Alt-Mod-t',
        run: () => runEdit(() => setLinePrefix('- [ ] '))
      },
      {
        key: 'Shift-Mod-u',
        run: () => runEdit(() => setLinePrefix('> '))
      },
      {
        key: 'Alt-Mod-s',
        run: () => runEdit(() => insertTextAt('\n---\n'))
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        key: `Alt-Mod-${index + 1}`,
        run: () => runEdit(() => setLinePrefix(`${'#'.repeat(index + 1)} `))
      })),
      {
        key: 'Alt-Mod-0',
        run: () => runEdit(() => setLinePrefix(''))
      },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap
    ]),
    EditorView.lineWrapping,
    EditorView.domEventHandlers({ paste: handlePaste }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      const isExternal = update.transactions.some((transaction) =>
        transaction.annotation(externalDocumentSync)
      )
      if (!isExternal) emit('change', update.state.doc.toString())
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
      '.cm-content': { caretColor: 'var(--accent-strong)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-strong)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 52%, transparent) !important'
      },
      '.cm-gutters': {
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--muted)',
        borderRightColor: 'var(--border)'
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'color-mix(in srgb, var(--hover) 62%, transparent)'
      }
    }),
    modeCompartment.of(modeExtensions()),
    editableCompartment.of(editableExtensions())
  ]
}

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    state: EditorState.create({ doc: props.content, extensions: baseExtensions() }),
    parent: host.value
  })
  resizeObserver = new ResizeObserver(() => {
    if (props.active) view?.requestMeasure()
  })
  resizeObserver.observe(host.value)
  appearanceObserver = new MutationObserver((changes) => {
    if (!changes.some((change) => change.attributeName === 'data-theme')) return
    view?.dispatch({ effects: modeCompartment.reconfigure(modeExtensions()) })
  })
  appearanceObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })
  requestAnimationFrame(() => view?.requestMeasure())
})

watch(
  () => props.content,
  (content) => {
    if (!view || content === view.state.doc.toString()) return
    const selection = view.state.selection.main
    const nextLength = content.length
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: {
        anchor: Math.min(selection.anchor, nextLength),
        head: Math.min(selection.head, nextLength)
      },
      annotations: externalDocumentSync.of(true)
    })
  }
)

watch(
  () => [props.mode, props.knowledgeBaseId, props.noteUuid, props.readOnly] as const,
  () => {
    view?.dispatch({
      effects: [
        modeCompartment.reconfigure(modeExtensions()),
        editableCompartment.reconfigure(editableExtensions())
      ]
    })
    void nextTick(() => requestAnimationFrame(() => view?.requestMeasure()))
  }
)

watch(
  () => props.active,
  (active) => {
    if (active) void nextTick(() => requestAnimationFrame(() => view?.requestMeasure()))
  }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  appearanceObserver?.disconnect()
  appearanceObserver = null
  view?.destroy()
  view = null
})
</script>

<template>
  <div
    ref="host"
    class="markdown-editor"
    :class="mode === 'readonly' ? 'mode-visual mode-readonly' : `mode-${mode}`"
  />
</template>

<style scoped>
.markdown-editor {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--editor-bg);
  color: var(--editor-text);
}

.markdown-editor :deep(.cm-editor) {
  background: inherit;
  color: inherit;
  font-size: 13px;
}

.markdown-editor :deep(.cm-scroller) {
  overflow: auto;
}

.markdown-editor :deep(.cm-content) ::selection,
.markdown-editor :deep(.cm-line) ::selection {
  background: color-mix(in srgb, var(--accent) 62%, #17325d) !important;
  color: #fff !important;
}

.markdown-editor.mode-source :deep(.cm-content) {
  padding: 20px max(24px, calc((100% - 940px) / 2));
}

:global(:root[data-theme='dark']) .markdown-editor.mode-source {
  background: #0d1117;
  color: #c9d1d9;
}

:global(:root[data-theme='light']) .markdown-editor.mode-source {
  background: #fff;
  color: #24292e;
}

.markdown-editor.mode-source :deep(.cm-editor),
.markdown-editor.mode-source :deep(.cm-scroller) {
  background: inherit;
  color: inherit;
}

:global(:root[data-theme='dark']) .markdown-editor.mode-source :deep(.cm-gutters) {
  border-right-color: #30363d;
  background: #0d1117;
  color: #8b949e;
}

:global(:root[data-theme='light']) .markdown-editor.mode-source :deep(.cm-gutters) {
  border-right-color: #d0d7de;
  background: #fff;
  color: #6e7781;
}

:global(:root[data-theme='dark']) .markdown-editor.mode-source :deep(.cm-content) ::selection,
:global(:root[data-theme='dark']) .markdown-editor.mode-source :deep(.cm-line) ::selection {
  background: #003d73 !important;
  color: #f0f6fc !important;
}

:global(:root[data-theme='light']) .markdown-editor.mode-source :deep(.cm-content) ::selection,
:global(:root[data-theme='light']) .markdown-editor.mode-source :deep(.cm-line) ::selection {
  background: #bbdfff !important;
  color: #24292e !important;
}

.markdown-editor.mode-visual {
  background: var(--document-bg);
  color: var(--document-text);
}

.markdown-editor.mode-visual :deep(.cm-editor),
.markdown-editor.mode-visual :deep(.cm-scroller) {
  background: var(--document-bg);
}

.markdown-editor.mode-visual :deep(.cm-content) {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  flex-grow: 0;
  padding: 34px max(72px, calc((100% - 860px) / 2)) 80px;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.65;
}

.markdown-editor.mode-visual :deep(.cm-line) {
  padding: 0;
  line-height: 1.65;
}

.markdown-editor.mode-visual :deep(.cm-line.cm-visual-spacer) {
  height: 8px;
  min-height: 8px;
  line-height: 8px;
}

.markdown-editor.mode-visual :deep(.cm-visual-live-line) {
  box-sizing: content-box;
  font-family: var(--font-sans);
}

.markdown-editor.mode-visual :deep(.cm-visual-live-paragraph.cm-visual-live-first),
.markdown-editor.mode-visual :deep(.cm-visual-live-list.cm-visual-live-first) {
  padding-top: 8px;
}

.markdown-editor.mode-visual :deep(.cm-visual-live-paragraph.cm-visual-live-last),
.markdown-editor.mode-visual :deep(.cm-visual-live-list.cm-visual-live-last) {
  padding-bottom: 8px;
}

.markdown-editor.mode-visual :deep(.cm-visual-live-heading) {
  color: var(--document-text);
  font-weight: 700;
  text-decoration: none !important;
}

.markdown-editor.mode-visual :deep(.cm-visual-live-heading *) {
  text-decoration: none !important;
}

.markdown-editor.mode-visual :deep(.cm-visual-heading-mark) {
  width: 0;
  display: inline-block;
  overflow: visible;
  color: var(--muted);
  opacity: 0.65;
  white-space: pre;
}

.markdown-editor.mode-visual :deep(.cm-visual-heading-mark-h1) {
  text-indent: -2ch;
}

.markdown-editor.mode-visual :deep(.cm-visual-heading-mark-h2) {
  text-indent: -3ch;
}

.markdown-editor.mode-visual :deep(.cm-visual-heading-mark-h3) {
  text-indent: -4ch;
}

.markdown-editor.mode-visual :deep(.cm-visual-heading-mark-h4) {
  text-indent: -5ch;
}

.markdown-editor.mode-visual :deep(.cm-visual-heading-mark-h5) {
  text-indent: -6ch;
}

.markdown-editor.mode-visual :deep(.cm-visual-heading-mark-h6) {
  text-indent: -7ch;
}

.markdown-editor.mode-visual :deep(.cm-visual-live-h1) {
  padding: 0 0 28px;
  font-size: 31px;
  line-height: 1.25;
}

.markdown-editor.mode-visual :deep(.cm-visual-live-h2) {
  position: relative;
  padding: 24px 0 10px;
  font-size: 23px;
  line-height: 1.35;
}

.markdown-editor.mode-visual :deep(.cm-visual-h2-fold) {
  position: absolute;
  top: calc(50% + 7px);
  left: -30px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
  border: 0;
  border-radius: 5px;
  outline: 0;
  background: transparent;
  padding: 0;
  color: var(--muted);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    color 120ms ease,
    background 120ms ease,
    opacity 120ms ease;
}

.markdown-editor.mode-visual :deep(.cm-visual-h2-fold svg) {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  transform: rotate(90deg);
  transition: transform 150ms ease;
}

.markdown-editor.mode-visual :deep(.cm-visual-h2-fold[data-collapsed='true'] svg) {
  transform: rotate(0deg);
}

.markdown-editor.mode-visual :deep(.cm-visual-live-h2:hover .cm-visual-h2-fold),
.markdown-editor.mode-visual :deep(.cm-visual-h2-fold:focus-visible),
.markdown-editor.mode-visual :deep(.cm-visual-h2-collapsed .cm-visual-h2-fold) {
  opacity: 1;
  pointer-events: auto;
}

.markdown-editor.mode-visual :deep(.cm-visual-h2-fold:hover),
.markdown-editor.mode-visual :deep(.cm-visual-h2-fold:focus-visible) {
  background: var(--hover);
  color: var(--accent-strong);
}

.markdown-editor.mode-visual :deep(.cm-visual-live-h3) {
  padding: 20px 0 8px;
  font-size: 19px;
  line-height: 1.4;
}

.markdown-editor.mode-visual :deep(.cm-visual-live-h4) {
  padding: 18px 0 7px;
  font-size: 17px;
  line-height: 1.45;
}

.markdown-editor.mode-visual :deep(.cm-visual-live-h5) {
  padding: 16px 0 6px;
  font-size: 16px;
  line-height: 1.5;
}

.markdown-editor.mode-visual :deep(.cm-visual-live-h6) {
  padding: 14px 0 5px;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.55;
}

.markdown-editor.mode-visual :deep(.cm-visual-list-marker) {
  color: var(--document-text);
  white-space: pre;
}

.markdown-editor.mode-visual :deep(.cm-visual-inline-strong) {
  font-weight: 700;
}

.markdown-editor.mode-visual :deep(.cm-visual-inline-emphasis) {
  font-style: italic;
}

.markdown-editor.mode-visual :deep(.cm-visual-inline-strike) {
  color: var(--muted);
  text-decoration: line-through;
}

.markdown-editor.mode-visual :deep(.cm-visual-inline-code) {
  border-radius: 4px;
  background: color-mix(in srgb, var(--raised) 80%, transparent);
  padding: 0.15em 0.35em;
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.markdown-editor.mode-visual :deep(.cm-visual-inline-link) {
  color: var(--accent-strong);
  text-decoration: none;
}

.markdown-editor.mode-visual :deep(.cm-visual-block) {
  width: 100%;
  box-sizing: border-box;
  color: var(--document-text);
  font-family: var(--font-sans);
  line-height: 1.65;
  white-space: normal;
  cursor: text;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-editor) {
  overflow: hidden;
  margin: 12px 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--raised);
  cursor: default;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-toolbar) {
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--border);
  padding: 0 8px 0 12px;
  color: var(--muted);
  font-size: 11px;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-toolbar > div) {
  display: flex;
  align-items: center;
  gap: 5px;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-toolbar button) {
  min-width: 54px;
  height: 27px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  padding: 0 8px;
  color: var(--muted);
  cursor: pointer;
  font-size: 10px;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-toolbar button:hover) {
  background: var(--hover);
  color: var(--text);
}

.markdown-editor.mode-visual :deep(.tn-visual-block-toolbar button.primary) {
  background: var(--accent);
  color: white;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-toolbar button:disabled) {
  background: transparent;
  color: var(--muted);
  cursor: default;
  opacity: 0.4;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-layout) {
  min-height: 230px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.markdown-editor.mode-visual :deep(.tn-visual-block-source) {
  display: none;
  min-width: 0;
  border-right: 1px solid var(--border);
  background: var(--editor-bg);
}

.markdown-editor.mode-visual :deep(.tn-visual-block-editor.is-editing .tn-visual-block-layout) {
  grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr);
}

.markdown-editor.mode-visual :deep(.tn-visual-block-editor.is-editing .tn-visual-block-source) {
  display: block;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-source textarea) {
  width: 100%;
  height: 100%;
  min-height: 320px;
  display: block;
  resize: vertical;
  box-sizing: border-box;
  border: 0;
  outline: 0;
  background: transparent;
  padding: 14px 16px;
  color: var(--editor-text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.65;
  tab-size: 2;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-preview) {
  min-width: 0;
  min-height: 230px;
  display: grid;
  place-items: stretch;
  overflow: auto;
  background: var(--document-bg);
}

.markdown-editor.mode-visual :deep(.tn-visual-block-preview-host) {
  min-width: 0;
  min-height: 230px;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: 14px;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-preview-host > *) {
  max-width: 100%;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-preview-host > svg) {
  max-width: 100%;
  height: auto;
}

.markdown-editor.mode-visual :deep(.tn-visual-block-preview-host .tn-mindmap-canvas) {
  width: 100%;
  height: 360px;
}

@media (max-width: 1040px) {
  .markdown-editor.mode-visual :deep(.tn-visual-block-editor.is-editing .tn-visual-block-layout) {
    grid-template-columns: minmax(0, 1fr);
  }

  .markdown-editor.mode-visual :deep(.tn-visual-block-source) {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}

.markdown-editor.mode-readonly :deep(.cm-content) {
  cursor: default;
}

.markdown-editor.mode-readonly :deep(.cm-activeLine) {
  background: transparent !important;
}

.markdown-editor.mode-readonly :deep(.cm-visual-h2-foldable) {
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease;
}

.markdown-editor.mode-readonly :deep(.cm-visual-h2-foldable:hover),
.markdown-editor.mode-readonly :deep(.cm-visual-h2-foldable:focus-visible),
.markdown-editor.mode-readonly :deep(.cm-visual-h2-collapsed) {
  background: var(--hover) !important;
}

.markdown-editor.mode-readonly :deep(.cm-visual-h2-foldable:focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 2px;
}

.markdown-editor.mode-readonly :deep(.cm-cursor),
.markdown-editor.mode-readonly :deep(.cm-dropCursor) {
  display: none !important;
}

.markdown-editor.mode-visual :deep(.cm-visual-block > :first-child) {
  margin-top: 0;
}

.markdown-editor.mode-visual :deep(.cm-visual-block > :last-child) {
  margin-bottom: 0;
}

.markdown-editor.mode-visual :deep(.cm-visual-block h1) {
  margin: 0 0 28px;
  font-size: 31px;
  line-height: 1.25;
}

.markdown-editor.mode-visual :deep(.cm-visual-block h2) {
  margin: 24px 0 10px;
  font-size: 23px;
}

.markdown-editor.mode-visual :deep(.cm-visual-block h3) {
  margin: 20px 0 8px;
  font-size: 19px;
}

.markdown-editor.mode-visual :deep(.cm-visual-block p),
.markdown-editor.mode-visual :deep(.cm-visual-block ul),
.markdown-editor.mode-visual :deep(.cm-visual-block ol),
.markdown-editor.mode-visual :deep(.cm-visual-block blockquote) {
  margin: 8px 0;
}

.markdown-editor.mode-visual :deep(.cm-visual-block a) {
  color: var(--accent-strong);
  text-decoration: none;
}

.markdown-editor.mode-visual :deep(.cm-visual-block a:hover) {
  text-decoration: underline;
}

.markdown-editor.mode-visual :deep(.cm-visual-block code) {
  border-radius: 4px;
  background: color-mix(in srgb, var(--raised) 80%, transparent);
  padding: 0.15em 0.35em;
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.markdown-editor.mode-visual :deep(.cm-visual-block pre) {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--raised);
  padding: 14px;
}

.markdown-editor.mode-visual :deep(.cm-visual-block pre code) {
  background: transparent;
  padding: 0;
}

.markdown-editor.mode-visual :deep(.cm-visual-block table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}

.markdown-editor.mode-visual :deep(.cm-visual-block th),
.markdown-editor.mode-visual :deep(.cm-visual-block td) {
  border: 1px solid var(--border-strong);
  padding: 7px 9px;
  text-align: left;
}

.markdown-editor.mode-visual :deep(.cm-visual-block img) {
  display: block;
  max-width: 100%;
  max-height: 640px;
  margin: 12px auto;
  border-radius: 7px;
}

.markdown-editor.mode-visual :deep(.tn-math-inline) {
  margin: 0 0.08em;
}

.markdown-editor.mode-visual :deep(.tn-math-block) {
  overflow-x: auto;
  padding: 12px 8px;
  text-align: center;
}

.markdown-editor.mode-visual :deep(.katex) {
  color: var(--document-text);
  font-size: 1.05em;
}

.markdown-editor.mode-visual :deep(.cm-visual-generated) {
  border-left: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
  padding-left: 14px;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc) {
  margin: 6px 0 12px;
  border-left: 0;
  padding-left: 0;
  cursor: default;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-header) {
  width: 100%;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  padding: 0 11px;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  text-align: left;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    color 120ms ease;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-header:hover),
.markdown-editor.mode-visual :deep(.cm-visual-toc-header:focus-visible),
.markdown-editor.mode-visual :deep(.cm-visual-toc.is-collapsed .cm-visual-toc-header) {
  border-color: var(--border);
  outline: 0;
  background: var(--hover);
  color: var(--document-text);
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-header svg) {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  transform: rotate(90deg);
  transition: transform 150ms ease;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc.is-collapsed .cm-visual-toc-header svg) {
  transform: rotate(0deg);
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-content) {
  margin-top: 3px;
  border-left: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
  padding: 3px 0 3px 14px;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-content[hidden]) {
  display: none;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-flat) {
  display: grid;
  gap: 1px;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-item) {
  min-width: 0;
  min-height: 24px;
  display: flex;
  align-items: baseline;
  gap: 7px;
  box-sizing: border-box;
  line-height: 1.55;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-item[data-depth='1']) {
  padding-left: 20px;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-item[data-depth='2']) {
  padding-left: 40px;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-item[data-depth='3']) {
  padding-left: 60px;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-item[data-depth='4']) {
  padding-left: 80px;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-item[data-depth='5']) {
  padding-left: 100px;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-marker) {
  width: 10px;
  flex: 0 0 10px;
  color: var(--document-text);
  text-align: center;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-item-label) {
  min-width: 0;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-content ul),
.markdown-editor.mode-visual :deep(.cm-visual-toc-content ol) {
  margin-top: 0;
  margin-bottom: 0;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-content li) {
  min-height: 0;
  margin-top: 0;
  margin-bottom: 0;
}

.markdown-editor.mode-visual :deep(.cm-visual-generated ul),
.markdown-editor.mode-visual :deep(.cm-visual-generated ol) {
  margin: 2px 0;
  padding-left: 20px;
}

.markdown-editor.mode-visual :deep(.cm-visual-generated li) {
  margin: 1px 0;
  line-height: 1.55;
}

/* The generated TOC must stay dense even when browser or Markdown list defaults
   introduce block margins for nested lists. */
.markdown-editor.mode-visual :deep(.cm-visual-toc-content ul),
.markdown-editor.mode-visual :deep(.cm-visual-toc-content ol) {
  display: block !important;
  margin: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-content li) {
  display: list-item !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  line-height: 1.55 !important;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-content li > ul),
.markdown-editor.mode-visual :deep(.cm-visual-toc-content li > ol) {
  margin-block: 0 !important;
}

.markdown-editor.mode-visual :deep(.cm-visual-toc-content a) {
  display: inline !important;
  margin: 0 !important;
  padding: 0 !important;
  line-height: inherit !important;
}

.markdown-editor.mode-visual :deep(.tn-container) {
  margin: 12px 0;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--raised);
  padding: 12px 14px;
}

.markdown-editor.mode-visual :deep(.tn-container > strong) {
  display: block;
  margin-bottom: 7px;
  color: var(--accent-strong);
}

.markdown-editor.mode-visual :deep(.tn-container-details summary) {
  cursor: pointer;
  color: var(--accent-strong);
  font-weight: 650;
}

.markdown-editor.mode-visual :deep(.tn-swiper) {
  overflow: hidden;
  margin: 12px 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--raised);
}

.markdown-editor.mode-visual :deep(.tn-swiper figure) {
  display: none;
  min-height: 180px;
  margin: 0;
  place-items: center;
  padding: 12px;
}

.markdown-editor.mode-visual :deep(.tn-swiper figure.active) {
  display: grid;
}

.markdown-editor.mode-visual :deep(.tn-swiper figure img) {
  margin: 0 auto;
}

.markdown-editor.mode-visual :deep(.tn-swiper footer) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 34px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 10px;
}

.markdown-editor.mode-visual :deep(.tn-swiper button),
.markdown-editor.mode-visual :deep(.tn-code-group button),
.markdown-editor.mode-visual :deep(.tn-note-reference) {
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.markdown-editor.mode-visual :deep(.tn-component-host) {
  display: contents;
}

.markdown-editor.mode-visual :deep(.tn-bilibili) {
  min-height: 92px;
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 12px 0;
  border: 1px solid color-mix(in srgb, #fb7299 45%, var(--border));
  border-radius: 10px;
  background: color-mix(in srgb, #fb7299 8%, var(--raised));
  padding: 14px 16px;
  color: var(--text);
  text-decoration: none;
}

.markdown-editor.mode-visual :deep(.tn-bilibili-play) {
  width: 46px;
  height: 46px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #fb7299;
  color: white;
  font-size: 17px;
}

.markdown-editor.mode-visual :deep(.tn-bilibili > span:last-child) {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.markdown-editor.mode-visual :deep(.tn-bilibili small) {
  color: var(--muted);
}

.markdown-editor.mode-visual :deep(.tn-word-list) {
  margin: 12px 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--raised);
  padding: 12px;
}

.markdown-editor.mode-visual :deep(.tn-word-list > header) {
  display: flex;
  justify-content: space-between;
  margin-bottom: 9px;
  color: var(--muted);
  font-size: 11px;
}

.markdown-editor.mode-visual :deep(.tn-word-list > div) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 5px;
}

.markdown-editor.mode-visual :deep(.tn-word) {
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 5px;
  padding: 5px 7px;
  cursor: pointer;
}

.markdown-editor.mode-visual :deep(.tn-word:hover) {
  background: var(--hover);
}

.markdown-editor.mode-visual :deep(.tn-word:has(input:checked) span) {
  color: var(--muted);
  text-decoration: line-through;
}

.markdown-editor.mode-visual :deep(.tn-footprints) {
  margin: 12px 0;
  border-left: 2px solid var(--accent);
  border-radius: 0 9px 9px 0;
  background: var(--raised);
  padding: 13px 14px;
}

.markdown-editor.mode-visual :deep(.tn-footprints > header) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 11px;
}

.markdown-editor.mode-visual :deep(.tn-footprints > header span) {
  color: var(--accent);
}

.markdown-editor.mode-visual :deep(.tn-footprints-text p) {
  margin: 5px 0;
}

.markdown-editor.mode-visual :deep(.tn-footprints-images) {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}

.markdown-editor.mode-visual :deep(.tn-footprints-images img) {
  width: 100%;
  height: 150px;
  margin: 0;
  object-fit: cover;
}

.markdown-editor.mode-visual :deep(.tn-tooltip) {
  position: relative;
  border-bottom: 1px dotted var(--accent);
  cursor: help;
}

.markdown-editor.mode-visual :deep(.tn-tooltip:hover::after) {
  content: attr(data-tooltip);
  position: absolute;
  z-index: 20;
  left: 50%;
  bottom: calc(100% + 7px);
  transform: translateX(-50%);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--raised);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 6px 9px;
  color: var(--text);
  white-space: nowrap;
  font-size: 10px;
}

.markdown-editor.mode-visual :deep(.tn-swiper button:hover),
.markdown-editor.mode-visual :deep(.tn-code-group button:hover),
.markdown-editor.mode-visual :deep(.tn-note-reference:hover) {
  background: var(--hover);
  color: var(--text);
}

.markdown-editor.mode-visual :deep(.tn-code-group) {
  overflow: hidden;
  margin: 12px 0;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  background: var(--raised);
}

.markdown-editor.mode-visual :deep(.tn-code-group nav) {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  padding: 5px 7px 0;
  border-bottom: 1px solid var(--border);
}

.markdown-editor.mode-visual :deep(.tn-code-group button) {
  flex: none;
  padding: 6px 9px;
  font-size: 10px;
}

.markdown-editor.mode-visual :deep(.tn-code-group button.active) {
  color: var(--accent-strong);
  box-shadow: inset 0 -2px var(--accent);
}

.markdown-editor.mode-visual :deep(.tn-code-group pre) {
  display: none;
  margin: 0;
  border: 0;
  border-radius: 0;
}

.markdown-editor.mode-visual :deep(.tn-code-group pre.active) {
  display: block;
}

.markdown-editor.mode-visual :deep(.tn-mindmap),
.markdown-editor.mode-visual :deep(.tn-mermaid) {
  min-height: 300px;
  overflow: hidden;
  margin: 12px 0;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--raised);
}

.markdown-editor.mode-visual :deep(.tn-mindmap-canvas) {
  width: 100%;
  height: 360px;
  position: relative;
  overflow: hidden;
}

.markdown-editor.mode-visual :deep(.tn-mindmap-canvas .mm-canvas),
.markdown-editor.mode-visual :deep(.tn-mindmap-canvas .mm-overlay) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.markdown-editor.mode-visual :deep(.tn-mermaid) {
  display: grid;
  place-items: center;
  overflow: auto;
  padding: 18px;
}

.markdown-editor.mode-visual :deep(.tn-mermaid svg) {
  max-width: 100%;
  height: auto;
}

.markdown-editor.mode-visual :deep(.tn-note-references) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 7px;
  margin: 10px 0;
}

.markdown-editor.mode-visual :deep(.tn-note-reference) {
  min-height: 36px;
  border: 1px solid var(--border);
  background: var(--raised);
  padding: 7px 10px;
  text-align: left;
}

.markdown-editor.mode-visual :deep(.tn-component-placeholder) {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 10px 0;
  border: 1px dashed var(--border-strong);
  border-radius: 7px;
  padding: 10px 12px;
  color: var(--muted);
}

.markdown-editor.mode-visual :deep(.tn-special-loading),
.markdown-editor.mode-visual :deep(.tn-special-error) {
  min-height: 180px;
  display: grid;
  place-items: center;
  padding: 16px;
  color: var(--muted);
  font-size: 11px;
}

.markdown-editor.mode-visual :deep(.tn-special-error) {
  color: var(--danger);
}
</style>
