import { watch } from 'vue'

import { includeLanguage, parseDeskIncludeLine } from '../../editor/markdown/deskInclude'
import {
  mountCodeTabEditor,
  type CodeTabEditorHandle
} from '../../editor/markdown/deskCodeTabEditor'
import { useWorkspaceStore } from '../../stores/workspace'
import { noteFileKey } from '../../stores/workspace/helpers'
import type { DeskRawBlockMountContext } from './types'

export function mountRawInclude(ctx: DeskRawBlockMountContext): void {
  const { block, dom, cleanupTasks, deps } = ctx

  const include = parseDeskIncludeLine(block.source)
  const editable = !deps.isEffectivelyReadOnly()
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
  let stopSessionWatch: (() => void) | null = null
  cleanupTasks.push(() => {
    cancelled = true
    tabEditor?.destroy()
    tabEditor = null
    stopSessionWatch?.()
    stopSessionWatch = null
  })

  void (async () => {
    if (!include) {
      bodyHost.textContent = '无法解析文件引用'
      return
    }
    try {
      const workspace = useWorkspaceStore()
      const knowledgeBaseId = deps.knowledgeBaseId()
      const noteUuid = deps.noteUuid()
      const key = noteFileKey(knowledgeBaseId, noteUuid, include.path)
      const session = await workspace.ensureNoteFile(knowledgeBaseId, noteUuid, include.path)
      if (cancelled) return

      if (!editable) {
        const pre = document.createElement('pre')
        pre.className = 'desk-raw-block__include-pre'
        pre.textContent = session.content
        bodyHost.replaceChildren(pre)
        stopSessionWatch = watch(
          () => workspace.getNoteFileSession(knowledgeBaseId, noteUuid, include.path)?.content,
          (content) => {
            if (content !== undefined) pre.textContent = content
          }
        )
        return
      }

      tabEditor = mountCodeTabEditor(bodyHost, {
        initialContent: session.content,
        saveOnBlur: false,
        language: includeLanguage(include),
        onCopy: (text) => deps.writeClipboard(text),
        onChange: (content) => workspace.updateNoteFileContent(key, content),
        onDirtyChange: (dirty) => {
          dom.classList.toggle('is-include-dirty', dirty)
        },
        onSave: async (content) => {
          workspace.updateNoteFileContent(key, content)
          try {
            await workspace.saveNoteFile(key)
            return { ok: true }
          } catch (cause) {
            return { ok: false, message: cause instanceof Error ? cause.message : String(cause) }
          }
        }
      })
      stopSessionWatch = watch(
        () => workspace.getNoteFileSession(knowledgeBaseId, noteUuid, include.path),
        (next) => {
          if (!next || !tabEditor) return
          tabEditor.setValue(next.content)
          tabEditor.setSavedValue(next.document.content)
        },
        { deep: true }
      )
    } catch (error) {
      if (cancelled) return
      bodyHost.textContent = `引用失败：${error instanceof Error ? error.message : String(error)}`
    }
  })()
}
