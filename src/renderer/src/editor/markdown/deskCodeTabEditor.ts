import { languages } from '@codemirror/language-data'

import {
  createContainerSourceEditor,
  type ContainerSourceEditorHandle
} from './containerSourceEditor'

export type CodeTabSaveResult = { ok: true } | { ok: false; message: string }

export interface CodeTabEditorHandle {
  getValue(): string
  setValue(value: string): void
  setSavedValue(value: string): void
  setLanguage(language: string): void
  destroy(): void
  isDirty(): boolean
  /** Persist if dirty (blur / tab switch / Mod-Enter). */
  flushSave(): Promise<void>
}

export interface MountCodeTabEditorOptions {
  initialContent: string
  /** Persist current editor value. Called on blur / Mod-Enter / flushSave. */
  onSave: (content: string) => Promise<CodeTabSaveResult>
  /** CodeMirror language id (js, json, bash, …). */
  language?: string
  /**
   * When true (default), show language picker + copy in the top-right tools
   * cluster (same chrome as standalone milkdown code blocks).
   */
  showTools?: boolean
  /** Called after the user picks a language from the picker. */
  onLanguageChange?: (language: string) => void | Promise<void>
  /** Optional clipboard writer; falls back to navigator.clipboard / execCommand. */
  onCopy?: (text: string) => void | Promise<void>
  /** Toggle dirty class on an ancestor (e.g. tab button / card). */
  onDirtyChange?: (dirty: boolean) => void
  /** Mirrors every user or programmatic document update to a shared resource store. */
  onChange?: (content: string) => void
  /** VitePress-style clickable line highlights for this tab's CodeMirror. */
  lineHighlight?: {
    initial?: string
    onChange?: (encoded: string) => void
    readOnly?: () => boolean
  }
}

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="none" aria-hidden="true"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z"></path></svg>`

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`

const LANGUAGE_OPTIONS: { id: string; label: string }[] = (() => {
  const seen = new Set<string>()
  const out: { id: string; label: string }[] = []
  for (const lang of languages) {
    const id = (lang.alias[0] ?? lang.name).toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: lang.name })
  }
  out.sort((a, b) => a.label.localeCompare(b.label))
  return out
})()

async function defaultCopy(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through — Electron may deny async clipboard without gesture path.
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

function readCmPlainText(host: HTMLElement): string {
  const lines = host.querySelectorAll('.cm-line')
  if (lines.length > 0) {
    return Array.from(lines, (line) => line.textContent ?? '').join('\n')
  }
  return host.querySelector('.cm-content')?.textContent ?? ''
}

/**
 * Mounts a code-block-like CodeMirror editor without Save/Revert chrome.
 * Writes back on blur and Mod-Enter; caller decides file vs note persistence.
 */
export function mountCodeTabEditor(
  host: HTMLElement,
  options: MountCodeTabEditorOptions
): CodeTabEditorHandle {
  let savedContent = options.initialContent
  let currentLanguage = (options.language || 'text').trim() || 'text'
  let dirty = false
  let saving = false
  let cancelled = false
  let editor: ContainerSourceEditorHandle | null = null
  let pickerOpen = false

  const shell = document.createElement('div')
  shell.className = 'desk-code-tab milkdown-code-block'

  const tools = document.createElement('div')
  tools.className = 'tools desk-code-tab__tools'

  // Match Crepe/Milkdown: language button is a sibling of the copy
  // button-group (not nested), so shared code-block CSS applies.
  const languageButton = document.createElement('button')
  languageButton.type = 'button'
  languageButton.className = 'language-button'
  const languageLabel = document.createElement('span')
  languageLabel.className = 'language-button__label'
  languageLabel.textContent = currentLanguage
  const expandIcon = document.createElement('span')
  expandIcon.className = 'expand-icon'
  expandIcon.innerHTML = EXPAND_ICON
  languageButton.append(languageLabel, expandIcon)

  const buttonGroup = document.createElement('div')
  buttonGroup.className = 'tools-button-group'

  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.className = 'copy-button'
  copyButton.title = 'Copy'
  copyButton.innerHTML = `${COPY_ICON}<span>Copy</span>`
  buttonGroup.append(copyButton)

  const picker = document.createElement('div')
  picker.className = 'language-picker'
  picker.hidden = true

  const listWrapper = document.createElement('div')
  listWrapper.className = 'list-wrapper'

  const searchBox = document.createElement('div')
  searchBox.className = 'search-box'
  const searchInput = document.createElement('input')
  searchInput.type = 'search'
  searchInput.placeholder = 'Search language'
  searchInput.autocomplete = 'off'
  searchBox.append(searchInput)

  const languageList = document.createElement('div')
  languageList.className = 'language-list'
  languageList.setAttribute('role', 'listbox')

  listWrapper.append(searchBox, languageList)
  picker.append(listWrapper)
  tools.append(languageButton, buttonGroup, picker)

  const cmHost = document.createElement('div')
  cmHost.className = 'desk-raw-block__include-cm desk-code-tab__cm'

  const statusEl = document.createElement('div')
  statusEl.className = 'desk-raw-block__include-status'
  statusEl.hidden = true

  if (options.showTools === false) {
    shell.append(cmHost)
  } else {
    shell.append(tools, cmHost)
  }
  host.replaceChildren(shell, statusEl)

  const setStatus = (message: string, kind: 'idle' | 'error' | 'ok' = 'idle'): void => {
    if (!message) {
      statusEl.hidden = true
      statusEl.textContent = ''
      statusEl.dataset.kind = 'idle'
      return
    }
    statusEl.hidden = false
    statusEl.textContent = message
    statusEl.dataset.kind = kind
  }

  const syncDirtyUi = (): void => {
    shell.classList.toggle('is-dirty', dirty)
    options.onDirtyChange?.(dirty)
  }

  const applyLanguageLabel = (language: string): void => {
    currentLanguage = language.trim() || 'text'
    languageLabel.textContent = currentLanguage
  }

  const closePicker = (): void => {
    pickerOpen = false
    picker.hidden = true
    languageButton.dataset.expanded = 'false'
    searchInput.value = ''
  }

  const renderLanguageList = (query: string): void => {
    const q = query.trim().toLowerCase()
    languageList.replaceChildren()
    const matches = LANGUAGE_OPTIONS.filter(
      (item) => !q || item.id.includes(q) || item.label.toLowerCase().includes(q)
    ).slice(0, 80)
    for (const item of matches) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'language-list-item'
      row.setAttribute('role', 'option')
      row.textContent = item.label
      if (item.id === currentLanguage.toLowerCase()) {
        row.dataset.selected = 'true'
      }
      row.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        void selectLanguage(item.id)
      })
      languageList.append(row)
    }
  }

  const openPicker = (): void => {
    pickerOpen = true
    picker.hidden = false
    languageButton.dataset.expanded = 'true'
    renderLanguageList('')
    searchInput.focus()
  }

  const selectLanguage = async (language: string): Promise<void> => {
    closePicker()
    if (language === currentLanguage) return
    applyLanguageLabel(language)
    editor?.setLanguage(language)
    await options.onLanguageChange?.(language)
  }

  languageButton.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (pickerOpen) closePicker()
    else openPicker()
  })

  searchInput.addEventListener('input', () => {
    renderLanguageList(searchInput.value)
  })

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePicker()
      languageButton.focus()
    }
  })

  copyButton.addEventListener('click', (event) => {
    // Capture handler on the editor also targets `.copy-button`; stop here so
    // we own the payload (CM line join) and avoid a double write.
    event.preventDefault()
    event.stopPropagation()
    const text = editor?.getValue() ?? readCmPlainText(cmHost)
    void (async () => {
      try {
        if (options.onCopy) await options.onCopy(text)
        else await defaultCopy(text)
        copyButton.dataset.copied = 'true'
        window.setTimeout(() => {
          delete copyButton.dataset.copied
        }, 1200)
      } catch {
        /* ignore */
      }
    })()
  })

  const onDocPointerDown = (event: PointerEvent): void => {
    if (!pickerOpen) return
    const target = event.target as Node | null
    if (target && tools.contains(target)) return
    closePicker()
  }
  document.addEventListener('pointerdown', onDocPointerDown)

  const save = async (): Promise<void> => {
    if (!editor || !dirty || saving || cancelled) return
    saving = true
    syncDirtyUi()
    try {
      const content = editor.getValue()
      const result = await options.onSave(content)
      if (cancelled) return
      if (!result.ok) {
        setStatus(`保存失败：${result.message}`, 'error')
        return
      }
      savedContent = content
      dirty = false
      setStatus('')
    } catch (error) {
      if (cancelled) return
      setStatus(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      saving = false
      syncDirtyUi()
    }
  }

  editor = createContainerSourceEditor(
    cmHost,
    options.initialContent,
    (value) => {
      dirty = value !== savedContent
      if (dirty) setStatus('')
      syncDirtyUi()
      options.onChange?.(value)
    },
    () => {
      void save()
    },
    { language: options.language, lineHighlight: options.lineHighlight }
  )
  syncDirtyUi()

  // Blur autosave: leaving the CM (or the shell) persists when dirty.
  shell.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null
    if (next && shell.contains(next)) return
    if (next && tools.contains(next)) return
    closePicker()
    void save()
  })

  return {
    getValue: () => editor?.getValue() ?? savedContent,
    setValue: (value: string) => editor?.setValue(value),
    setSavedValue: (value: string) => {
      savedContent = value
      dirty = (editor?.getValue() ?? value) !== savedContent
      syncDirtyUi()
    },
    setLanguage: (language: string) => {
      applyLanguageLabel(language)
      editor?.setLanguage(language)
    },
    destroy: () => {
      cancelled = true
      document.removeEventListener('pointerdown', onDocPointerDown)
      closePicker()
      editor?.destroy()
      editor = null
    },
    isDirty: () => dirty,
    flushSave: () => save()
  }
}
