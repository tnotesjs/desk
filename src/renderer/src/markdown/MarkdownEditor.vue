<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
      lineNumbers(),
      foldGutter(),
      highlightActiveLineGutter(),
      EditorView.editorAttributes.of({ class: 'cm-source-editor' })
    ]
  }
  return visualMarkdownExtensions(
    { knowledgeBaseId: props.knowledgeBaseId, noteUuid: props.noteUuid },
    openLink,
    { openNote: (noteUuid) => emit('openNote', noteUuid) }
  )
}

function editableExtensions(): Extension[] {
  return [EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]
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
  if (!view || props.readOnly) return
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
  if (!view || props.readOnly) return
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
  if (!view || props.readOnly) return
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

defineExpose({ insertTextAt, wrapSelection, prefixSelection })

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
        backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)'
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
  () => [props.mode, props.knowledgeBaseId, props.noteUuid] as const,
  () => view?.dispatch({ effects: modeCompartment.reconfigure(modeExtensions()) })
)

watch(
  () => props.readOnly,
  () => view?.dispatch({ effects: editableCompartment.reconfigure(editableExtensions()) })
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div ref="host" class="markdown-editor" :class="`mode-${mode}`" />
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

.markdown-editor.mode-source :deep(.cm-content) {
  padding: 20px max(24px, calc((100% - 940px) / 2));
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
  width: min(860px, calc(100% - 48px));
  min-height: 100%;
  margin: 0 auto;
  padding: 34px 0 80px;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.75;
}

.markdown-editor.mode-visual :deep(.cm-line) {
  padding: 0;
}

.markdown-editor.mode-visual :deep(.cm-visual-block) {
  width: min(860px, calc(100vw - 70px));
  box-sizing: border-box;
  color: var(--document-text);
  font-family: var(--font-sans);
  line-height: 1.75;
  cursor: text;
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

.markdown-editor.mode-visual :deep(.cm-visual-generated) {
  border-left: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
  padding-left: 14px;
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
