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
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
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
import { clearSourceLineStyles } from './clearSourceLineStyles'

import type { NotePageWidth, NoteViewMode } from '../../../shared/contracts'

const props = withDefaults(
  defineProps<{
    content: string
    mode: NoteViewMode
    pageWidth?: NotePageWidth
    readOnly: boolean
    knowledgeBaseId: string
    noteUuid: string
    active: boolean
  }>(),
  { pageWidth: 'standard' }
)

const emit = defineEmits<{
  change: [content: string]
  openLink: [url: string]
  openNote: [noteUuid: string]
  pasteImage: [file: File, insertAt: number]
}>()

const host = ref<HTMLElement | null>(null)
const themeCompartment = new Compartment()
const editableCompartment = new Compartment()
const externalDocumentSync = Annotation.define<boolean>()
let view: EditorView | null = null
let resizeObserver: ResizeObserver | null = null
let appearanceObserver: MutationObserver | null = null

function isEffectivelyReadOnly(): boolean {
  return props.readOnly || props.mode === 'readonly'
}

function themeExtension(): Extension {
  return document.documentElement.dataset.theme === 'light' ? githubLight : githubDark
}

function editableExtensions(): Extension[] {
  const readOnly = isEffectivelyReadOnly()
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

function handlePaste(event: ClipboardEvent, editorView: EditorView): boolean {
  const image = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .find((item): item is File => Boolean(item))
  if (!image) return false
  event.preventDefault()
  emit('pasteImage', image, editorView.state.selection.main.from)
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
    // Prefer native ::selection so multi-line highlights wrap the selected
    // characters only. drawSelection() paints full-width line rectangles.
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    autocompletion({ activateOnTyping: true, icons: false, maxRenderedOptions: 60 }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown(),
    EditorState.allowMultipleSelections.of(true),
    keymap.of([
      { key: 'Mod-\\', run: clearSourceLineStyles },
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
      '.cm-dropCursor': { borderLeftColor: 'var(--accent-strong)' },
      '.cm-gutters': {
        backgroundColor: 'var(--editor-bg)',
        color: 'var(--muted)',
        borderRightColor: 'var(--border)'
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'color-mix(in srgb, var(--hover) 62%, transparent)'
      }
    }),
    EditorView.editorAttributes.of({ class: 'cm-source-editor' }),
    lineNumbers(),
    foldGutter(),
    highlightActiveLineGutter(),
    themeCompartment.of(themeExtension()),
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
    view?.dispatch({ effects: themeCompartment.reconfigure(themeExtension()) })
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
  () => [props.mode, props.readOnly] as const,
  () => {
    view?.dispatch({ effects: editableCompartment.reconfigure(editableExtensions()) })
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
  <div ref="host" class="markdown-source-editor" :class="{ 'is-wide': pageWidth === 'wide' }" />
</template>

<style scoped>
.markdown-source-editor {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--editor-bg);
  color: var(--editor-text);
}

.markdown-source-editor :deep(.cm-editor) {
  background: inherit;
  color: inherit;
  font-size: 13px;
}

.markdown-source-editor :deep(.cm-scroller) {
  overflow: auto;
}

.markdown-source-editor :deep(.cm-content) {
  padding: 20px max(24px, calc((100% - 940px) / 2));
  user-select: text;
  -webkit-user-select: text;
}

.markdown-source-editor.is-wide :deep(.cm-content) {
  padding-inline: 24px;
}

.markdown-source-editor :deep(.cm-content) ::selection,
.markdown-source-editor :deep(.cm-line) ::selection {
  background: color-mix(in srgb, var(--accent) 55%, transparent) !important;
  color: var(--editor-text) !important;
}

:global(:root[data-theme='dark']) .markdown-source-editor {
  background: #0d1117;
  color: #c9d1d9;
}

:global(:root[data-theme='light']) .markdown-source-editor {
  background: #fff;
  color: #24292e;
}

.markdown-source-editor :deep(.cm-editor),
.markdown-source-editor :deep(.cm-scroller) {
  background: inherit;
  color: inherit;
}

:global(:root[data-theme='dark']) .markdown-source-editor :deep(.cm-gutters) {
  border-right-color: #30363d;
  background: #0d1117;
  color: #8b949e;
}

:global(:root[data-theme='light']) .markdown-source-editor :deep(.cm-gutters) {
  border-right-color: #d0d7de;
  background: #fff;
  color: #6e7781;
}

:global(:root[data-theme='dark']) .markdown-source-editor :deep(.cm-content) ::selection,
:global(:root[data-theme='dark']) .markdown-source-editor :deep(.cm-line) ::selection {
  background: color-mix(in srgb, var(--accent) 55%, transparent) !important;
  color: #f0f6fc !important;
}

:global(:root[data-theme='light']) .markdown-source-editor :deep(.cm-content) ::selection,
:global(:root[data-theme='light']) .markdown-source-editor :deep(.cm-line) ::selection {
  background: color-mix(in srgb, var(--accent) 42%, transparent) !important;
  color: #24292e !important;
}
</style>
