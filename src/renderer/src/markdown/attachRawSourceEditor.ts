import type { EditorView } from '@milkdown/kit/prose/view'

import {
  createContainerSourceEditor,
  type ContainerSourceEditorHandle
} from '../editor/markdown/containerSourceEditor'
import { deleteDeskRawBlockAt } from '../editor/markdown/rawBlockEmpty'
import { parseFencedCode, rebuildMermaidFence } from '../editor/markdown/diagramRenderer'
import {
  parseBilibiliVideoSource,
  parseWordListSource,
  parseNotesTableSource,
  rebuildBilibiliVideoSource,
  rebuildWordListSource,
  rebuildNotesTableSource
} from '../editor/markdown/componentBody'
import { parseContainerSource, rebuildContainerSource } from '../editor/markdown/containerBody'

export interface AttachRawSourceEditorDeps {
  isEffectivelyReadOnly: () => boolean
  rawSourceReadonlyListeners: Set<(readOnly: boolean) => void>
}

export interface RawSourceEditorContext {
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

export interface RawSourceEditorHandle {
  (): void
  destroy(): void
  /** Pull the latest atom source into an open Edit panel (e.g. after highlight writeback). */
  syncFromAtom(): void
}

/**
 * Wires the edit button + inline editor onto an editable raw block. Structured
 * callouts (tip/info/…) expose title + body only; other blocks still edit the
 * full source. Commits update the atom source and are reconciled by
 * sourcePreservation.
 */
export const EDIT_PILL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.06 9.02 14.98 9.94 5.92 19H5v-.92l9.06-9.06ZM17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41L18.37 3.29c-.2-.2-.45-.29-.71-.29ZM14.06 6.19 3 17.25V21h3.75L17.81 9.94 14.06 6.19Z"/></svg>`
export const DONE_PILL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.55 18.2 3.65 12.3l1.4-1.4 4.5 4.5L18.95 5.95l1.4 1.4z"/></svg>`

export function attachRawSourceEditor(
  ctx: RawSourceEditorContext,
  deps: AttachRawSourceEditorDeps
): RawSourceEditorHandle {
  const { isEffectivelyReadOnly, rawSourceReadonlyListeners } = deps
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
  /** Skip publishDraft while pulling atom → Edit panel (avoids preview remount). */
  let suppressPublish = false
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
    if (suppressPublish || isEffectivelyReadOnly()) return
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
      const open = fence.title ? `\`\`\`mindmap [${fence.title}]` : '```mindmap'
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
          placeholder: ctx.structuredMindmap ? '输入思维导图 Markdown…' : '编辑容器正文…'
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

  const destroy = (): void => {
    rawSourceReadonlyListeners.delete(applyReadonly)
    if (structured) {
      editorHost.removeEventListener('focusout', scheduleCommitOnBlur)
    }
    clearBlurCommit()
    if (syncTimer != null) clearTimeout(syncTimer)
    editorHandle?.destroy()
    editorHandle = null
  }

  const syncFromAtom = (): void => {
    if (!editing || !editorHandle) return
    const next = liveSource()
    editorValue = next
    // setValue fires docChanged → onChange → publishDraft; suppress so we don't
    // re-render the visual preview (and remount tab editors) while syncing.
    suppressPublish = true
    try {
      if (ctx.structuredCallout) {
        const parsed = parseContainerSource(next)
        draftTitle = parsed.title
        draftBody = parsed.body
        editorHandle.setValue(draftBody)
        const titleInput = editorHost.querySelector(
          '.desk-raw-block__editor-title'
        ) as HTMLInputElement | null
        if (titleInput && document.activeElement !== titleInput) {
          titleInput.value = draftTitle
        }
        return
      }
      if (ctx.structuredContainerBody) {
        draftContainerBody = parseContainerSource(next).body
        editorHandle.setValue(draftContainerBody)
        return
      }
      if (ctx.structuredMermaid) {
        draftMermaidBody = parseFencedCode(next).code
        editorHandle.setValue(draftMermaidBody)
        return
      }
      if (ctx.structuredMindmap) {
        draftMindmapBody = parseFencedCode(next).code
        editorHandle.setValue(draftMindmapBody)
        return
      }
      editorHandle.setValue(next)
    } finally {
      suppressPublish = false
    }
  }

  return Object.assign(destroy, { destroy, syncFromAtom })
}
