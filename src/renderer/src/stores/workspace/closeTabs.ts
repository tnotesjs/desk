import { nextTick, ref, type Ref } from 'vue'

import type { EditorTab } from '../../../../shared/contracts'
import type { useEditorStore } from '../editor'
import { resultValue } from './helpers'
import { flushPendingEdits, hasPendingEdits } from '../../editor/markdown/pendingEdits'

export interface ClosingResource {
  key: string
  title: string
  dirty(): boolean
  saving(): boolean
  pauseAutosave(): () => void
  waitForSave(): Promise<void>
  save(): Promise<void>
  discard(): Promise<void>
}

interface CloseTabsContext {
  editor: ReturnType<typeof useEditorStore>
  resourcesFor(tab: EditorTab): ClosingResource[]
  error: Ref<string | null>
  status: Ref<string | null>
}

export function createTabClosing(ctx: CloseTabsContext) {
  const closingTabs = ref(false)

  function isTabDirty(tab: EditorTab): boolean {
    return (
      (tab.type !== 'web' && tab.dirty) ||
      (tab.type === 'note' && hasPendingEdits(tab.knowledgeBaseId, tab.noteUuid)) ||
      ctx.resourcesFor(tab).some((resource) => resource.dirty())
    )
  }

  ctx.editor.setUnsavedChangesResolver(
    (tab) => isTabDirty(tab) || ctx.resourcesFor(tab).some((resource) => resource.saving())
  )

  async function closeTargets(ids: string[], allowPinned = false): Promise<boolean> {
    if (closingTabs.value) return false
    closingTabs.value = true
    const resume: Array<() => void> = []
    const knowledgeBaseId = ctx.editor.activeKnowledgeBaseId
    try {
      // Commit focused block editors into the shared document before inspecting dirty state.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      await nextTick()
      const targets = ctx.editor.groups
        .flatMap((group) => group.tabs)
        .filter((tab) => ids.includes(tab.id) && (allowPinned || !tab.pinned))
      for (const tab of targets) {
        if (tab.type === 'note') flushPendingEdits(tab.knowledgeBaseId, tab.noteUuid)
      }
      await nextTick()
      const resources = [
        ...new Map(
          targets.flatMap(ctx.resourcesFor).map((resource) => [resource.key, resource])
        ).values()
      ].filter((resource) => resource.dirty() || resource.saving())
      for (const resource of resources) resume.push(resource.pauseAutosave())
      // An already-running save cannot be undone. Wait for its result and then inspect remaining edits.
      await Promise.all(resources.map((resource) => resource.waitForSave().catch(() => undefined)))
      const dirty = resources.filter((resource) => resource.dirty())
      if (dirty.length) {
        const choice = resultValue(
          await window.desk.app.confirmTabClose(dirty.map((resource) => resource.title))
        )
        if (choice === 'cancel') return false
        for (const resource of dirty) {
          if (!resource.dirty()) continue
          if (choice === 'save') await resource.save()
          else await resource.discard()
          if (resource.dirty()) throw new Error('仍有未保存的更改，已取消关闭标签页。')
        }
      }
      if (targets.flatMap(ctx.resourcesFor).some((resource) => resource.dirty())) {
        throw new Error('仍有未保存的更改，已取消关闭标签页。')
      }
      if (ctx.editor.activeKnowledgeBaseId !== knowledgeBaseId) return false
      // Close only after every decision succeeds, so cancel/save failures leave the whole batch open.
      for (const target of targets) {
        const group = ctx.editor.groups.find((group) =>
          group.tabs.some((tab) => tab.id === target.id)
        )
        if (!group) continue
        if (allowPinned && target.pinned) ctx.editor.setPinned(target.id, false)
        ctx.editor.close(group.id, target.id)
      }
      return true
    } catch (cause) {
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      resume.forEach((restore) => restore())
      closingTabs.value = false
    }
  }

  function requestCloseTab(tabId: string, allowPinned = false): Promise<boolean> {
    const tab = ctx.editor.groups.flatMap((group) => group.tabs).find((tab) => tab.id === tabId)
    if (!tab) return Promise.resolve(false)
    if (tab.pinned && !allowPinned) {
      ctx.status.value = '固定标签需要先解除固定才能关闭'
      return Promise.resolve(false)
    }
    return closeTargets([tabId], allowPinned)
  }

  function requestCloseTabs(mode: 'all' | 'saved' | 'web'): Promise<boolean> {
    const targets = ctx.editor.groups
      .flatMap((group) => group.tabs)
      .filter(
        (tab) =>
          !tab.pinned &&
          (mode === 'all' ||
            (mode === 'web' ? tab.type === 'web' : tab.type !== 'web' && !isTabDirty(tab)))
      )
    return closeTargets(targets.map((tab) => tab.id))
  }

  return { requestCloseTab, requestCloseTabs, isTabDirty, closingTabs }
}
