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
import { languages } from '@codemirror/language-data'
import { searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection
} from '@codemirror/view'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'

import { createCodeLineHighlightExtension } from './codeLineHighlightExtension'
import { isEmptyRawBlockSource } from './rawBlockEmpty'

export interface ContainerSourceEditorHandle {
  getValue(): string
  setValue(value: string): void
  setLanguage(language: string): void
  focus(): void
  destroy(): void
}

export interface ContainerSourceEditorOptions {
  /**
   * When the source is empty (see `isEmptyRawBlockSource`) and Backspace is
   * pressed at the document start, remove the surrounding deskRawBlock.
   * Return true if the key was handled.
   */
  onEmptyBackspace?: () => boolean
  /** Shown when the document is empty (CodeMirror placeholder). */
  placeholder?: string
  /**
   * Fence / file language id (js, json, bash, …). Defaults to markdown for
   * container raw-source editing. Loaded via `@codemirror/language-data`.
   */
  language?: string
  /**
   * VitePress-style line highlights. Host already provides `lineNumbers()`,
   * so the extension is installed with `provideLineNumbers: false`.
   */
  lineHighlight?: {
    initial?: string
    onChange?: (encoded: string) => void
    readOnly?: () => boolean
  }
}

/**
 * Shared predicate + callback for the empty-Backspace gesture. Exported for
 * unit tests; the CodeMirror keymap delegates here.
 */
export function handleEmptyRawBlockBackspace(
  docText: string,
  selection: { empty: boolean; anchor: number },
  rangeCount: number,
  onEmptyBackspace: () => boolean
): boolean {
  if (rangeCount > 1) return false
  if (!selection.empty || selection.anchor > 0) return false
  if (!isEmptyRawBlockSource(docText)) return false
  return onEmptyBackspace()
}

function themeExtension(): Extension {
  return document.documentElement.dataset.theme === 'light' ? githubLight : githubDark
}

function normalizeLanguageName(language: string): string {
  const trimmed = language.trim().toLowerCase()
  if (!trimmed) return ''
  if (trimmed === 'js' || trimmed === 'mjs' || trimmed === 'cjs') return 'javascript'
  if (trimmed === 'ts') return 'typescript'
  if (trimmed === 'sh' || trimmed === 'zsh' || trimmed === 'shell') return 'bash'
  if (trimmed === 'md') return 'markdown'
  if (trimmed === 'yml') return 'yaml'
  if (trimmed === 'plaintext' || trimmed === 'text' || trimmed === 'txt') return ''
  return trimmed
}

/** Resolve a CodeMirror language extension for a fence/file language id. */
export async function resolveLanguageExtension(language?: string): Promise<Extension> {
  const name = normalizeLanguageName(language ?? '')
  if (!name || name === 'markdown') return markdown()

  const matched =
    languages.find((item) => item.name.toLowerCase() === name) ??
    languages.find((item) => item.alias.some((alias) => alias.toLowerCase() === name)) ??
    languages.find((item) => item.extensions.includes(name))

  if (!matched) return []
  try {
    return await matched.load()
  } catch {
    return []
  }
}

/**
 * Mounts a CodeMirror 6 editor into `host`. Defaults to markdown highlighting;
 * pass `options.language` for fence/file languages (js, json, …).
 */
export function createContainerSourceEditor(
  host: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void,
  onCommit: () => void,
  options: ContainerSourceEditorOptions = {}
): ContainerSourceEditorHandle {
  const themeCompartment = new Compartment()
  const languageCompartment = new Compartment()
  let destroyed = false

  const initialLanguage =
    !options.language || normalizeLanguageName(options.language) === 'markdown' ? markdown() : []

  const lineHighlight = options.lineHighlight
    ? createCodeLineHighlightExtension({
        initial: options.lineHighlight.initial,
        provideLineNumbers: false,
        readOnly: options.lineHighlight.readOnly,
        onChange: (encoded) => options.lineHighlight?.onChange?.(encoded)
      })
    : null

  const view = new EditorView({
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        highlightSpecialChars(),
        history(),
        // Prefer native ::selection so multi-line highlights wrap characters
        // only — same as MarkdownSourceEditor. drawSelection() paints full-width
        // line rectangles.
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        autocompletion({ activateOnTyping: true, icons: false, maxRenderedOptions: 60 }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageCompartment.of(initialLanguage),
        EditorState.allowMultipleSelections.of(true),
        ...(options.placeholder ? [placeholder(options.placeholder)] : []),
        ...(lineHighlight ? lineHighlight.extensions : []),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              setTimeout(onCommit, 0)
              return true
            }
          },
          {
            key: 'Backspace',
            run: () => {
              const { onEmptyBackspace } = options
              if (!onEmptyBackspace) return false
              const ranges = view.state.selection.ranges
              const selection = ranges[0]
              if (!selection) return false
              return handleEmptyRawBlockBackspace(
                view.state.doc.toString(),
                { empty: selection.empty, anchor: selection.anchor },
                ranges.length,
                onEmptyBackspace
              )
            }
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
          '.cm-content': { caretColor: 'var(--accent-strong)' },
          '&.cm-focused': { outline: 'none' },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-strong)' },
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
        themeCompartment.of(themeExtension())
      ]
    }),
    parent: host
  })

  if (options.language && normalizeLanguageName(options.language) !== 'markdown') {
    void resolveLanguageExtension(options.language).then((extension) => {
      if (destroyed) return
      view.dispatch({
        effects: languageCompartment.reconfigure(extension)
      })
    })
  }

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (value: string) => {
      const current = view.state.doc.toString()
      if (current === value) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value }
      })
    },
    setLanguage: (language: string) => {
      const name = normalizeLanguageName(language)
      if (!name || name === 'markdown') {
        view.dispatch({ effects: languageCompartment.reconfigure(markdown()) })
        return
      }
      void resolveLanguageExtension(language).then((extension) => {
        if (destroyed) return
        view.dispatch({ effects: languageCompartment.reconfigure(extension) })
      })
    },
    focus: () => view.focus(),
    destroy: () => {
      destroyed = true
      view.destroy()
    }
  }
}
