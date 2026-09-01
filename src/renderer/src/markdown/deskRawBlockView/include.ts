import { includeLanguage, parseDeskIncludeLine } from '../../editor/markdown/deskInclude'
import {
  mountCodeTabEditor,
  type CodeTabEditorHandle
} from '../../editor/markdown/deskCodeTabEditor'
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
        knowledgeBaseId: deps.knowledgeBaseId(),
        noteUuid: deps.noteUuid(),
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
        onCopy: (text) => deps.writeClipboard(text),
        onDirtyChange: (dirty) => {
          dom.classList.toggle('is-include-dirty', dirty)
        },
        onSave: async (content) => {
          const write = await window.desk.attachments.writeText({
            knowledgeBaseId: deps.knowledgeBaseId(),
            noteUuid: deps.noteUuid(),
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
