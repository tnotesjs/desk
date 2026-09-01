import {
  isBilibiliVideoSource,
  isWordListSource,
  isNotesTableSource,
  parseBilibiliVideoSource,
  parseWordListSource,
  parseNotesTableSource
} from '../../editor/markdown/componentBody'
import {
  mountBilibiliVideoPreview,
  mountNotesTablePreview,
  mountWordListPreview
} from '../../editor/markdown/componentPreview'
import { attachRawSourceEditor } from '../attachRawSourceEditor'
import type { DeskRawBlockMountContext } from './types'

export function mountRawComponent(ctx: DeskRawBlockMountContext): void {
  const { block, dom, view, getPos, cleanupTasks, deps } = ctx

  if (isBilibiliVideoSource(block.source)) {
    dom.classList.add('desk-raw-block--component', 'desk-raw-block--bilibili-video')
    dom.replaceChildren()
    const previewHost = document.createElement('div')
    previewHost.className = 'desk-raw-block__component-preview'
    dom.append(previewHost)
    const parsed = parseBilibiliVideoSource(block.source)
    const mounted = mountBilibiliVideoPreview(previewHost, {
      id: parsed?.id ?? '',
      autoplay: parsed?.autoplay,
      muted: parsed?.muted
    })
    cleanupTasks.push(() => mounted.unmount())
    cleanupTasks.push(
      attachRawSourceEditor(
        {
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
        },
        deps
      )
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
      attachRawSourceEditor(
        {
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
        },
        deps
      )
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
          knowledgeBaseId: deps.knowledgeBaseId(),
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
      attachRawSourceEditor(
        {
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
        },
        deps
      )
    )
  } else {
    const labelEl = dom.querySelector<HTMLElement>('.desk-raw-block__label')
    const previewEl = dom.querySelector<HTMLElement>('.desk-raw-block__preview')
    cleanupTasks.push(
      attachRawSourceEditor(
        {
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
        },
        deps
      )
    )
  }
}
