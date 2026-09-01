import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export const KNOWLEDGE_SIDEBAR_MIN = 52
export const KNOWLEDGE_SIDEBAR_DEFAULT = 218
export const KNOWLEDGE_SIDEBAR_MAX = 380
export const KNOWLEDGE_SIDEBAR_COMPACT = 104
export const NAVIGATOR_SIDEBAR_MIN = 200
export const NAVIGATOR_SIDEBAR_DEFAULT = 292
export const NAVIGATOR_SIDEBAR_MAX = 480

export function clampSidebarWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

import {
  activateTab as activateTabInLayout,
  collapseEmptyGroups,
  createGroup,
  createId,
  cycleTab,
  findGroup,
  findTab,
  insertTab,
  listGroups,
  removeTab,
  setSplitRatio,
  splitGroupWithTab,
  updateGroup
} from '../editor-groups/layoutModel'

import type {
  AppSettings,
  EditorLayoutNode,
  EditorTab,
  KnowledgeBaseDescriptor,
  NoteEditorTab,
  NoteViewMode,
  PreviewStateDto,
  WebEditorTab,
  WebTabState,
  WorkspaceSession
} from '../../../shared/contracts'
import type { SplitPlacement } from '../editor-groups/layoutModel'

const DEFAULT_WEB_URL = 'https://github.com/tnotesjs'

function cloneTab(tab: EditorTab): EditorTab {
  return {
    ...tab,
    id: createId(tab.type),
    openedAt: Date.now(),
    pinned: false,
    ...(tab.type === 'note' ? { preview: false } : {})
  }
}

function sanitizeLayout(node: EditorLayoutNode, knowledgeBaseIds: Set<string>): EditorLayoutNode {
  if (node.type === 'group') {
    const tabs = node.tabs
      .filter((tab) => {
        if (tab.type === 'note') return knowledgeBaseIds.has(tab.knowledgeBaseId)
        try {
          const url = new URL(tab.url)
          return url.protocol === 'http:' || url.protocol === 'https:'
        } catch {
          return false
        }
      })
      .map((tab, index) => ({
        ...tab,
        pinned: Boolean(tab.pinned),
        openedAt: tab.openedAt ?? Date.now() + index,
        ...(tab.type === 'note' ? { preview: Boolean(tab.preview), dirty: Boolean(tab.dirty) } : {})
      }))
    return {
      ...node,
      tabs,
      activeTabId: tabs.some((tab) => tab.id === node.activeTabId)
        ? node.activeTabId
        : (tabs[0]?.id ?? null)
    }
  }
  return collapseEmptyGroups({
    ...node,
    ratio: Math.max(0.15, Math.min(0.85, node.ratio)),
    first: sanitizeLayout(node.first, knowledgeBaseIds),
    second: sanitizeLayout(node.second, knowledgeBaseIds)
  })
}

export const useEditorStore = defineStore('editor', () => {
  const firstGroup = createGroup()
  const layout = ref<EditorLayoutNode>(firstGroup)
  const activeGroupId = ref(firstGroup.id)
  const webStates = ref<Record<string, WebTabState>>({})
  const previewStates = ref<Record<string, PreviewStateDto>>({})
  const knowledgeSidebarWidth = ref(KNOWLEDGE_SIDEBAR_DEFAULT)
  const navigatorSidebarWidth = ref(NAVIGATOR_SIDEBAR_DEFAULT)
  const knowledgeSidebarCollapsed = ref(false)
  const navigatorSidebarCollapsed = ref(false)
  const expandedTocNodes = ref<Record<string, string[]>>({})
  const maxOpenTabCount = ref(10)
  const wrapTabs = ref(true)
  let unsubscribeWebState: (() => void) | null = null
  let unsubscribeWebOpen: (() => void) | null = null
  let unsubscribePreview: (() => void) | null = null

  const groups = computed(() => listGroups(layout.value))
  const activeGroup = computed(
    () => findGroup(layout.value, activeGroupId.value) ?? groups.value[0] ?? null
  )
  const activeTab = computed(() => {
    const group = activeGroup.value
    return group?.tabs.find((tab) => tab.id === group.activeTabId) ?? null
  })
  const tabCount = computed(() =>
    groups.value.reduce((total, group) => total + group.tabs.length, 0)
  )

  function configure(settings: AppSettings): void {
    maxOpenTabCount.value = settings.tabs.maxOpenCount
    wrapTabs.value = settings.tabs.wrap
    trimToLimit()
  }

  function initializeWebEvents(): void {
    if (!unsubscribeWebState) {
      unsubscribeWebState = window.desk.web.onStateChanged((state) => {
        webStates.value = { ...webStates.value, [state.tabId]: state }
        const located = findTab(layout.value, state.tabId)
        if (located?.tab.type === 'web') {
          located.tab.url = state.url
          located.tab.title = state.title || state.url
          layout.value = { ...layout.value }
        }
      })
    }
    if (!unsubscribeWebOpen) {
      unsubscribeWebOpen = window.desk.web.onOpenRequested((event) => {
        const source = findTab(layout.value, event.sourceTabId)
        openWeb(event.url, source?.group.id)
      })
    }
    if (!unsubscribePreview) {
      unsubscribePreview = window.desk.preview.onChanged((state) => {
        previewStates.value = { ...previewStates.value, [state.knowledgeBaseId]: state }
      })
      void window.desk.preview.list().then((result) => {
        if (!result.ok) return
        previewStates.value = Object.fromEntries(
          result.value.map((state) => [state.knowledgeBaseId, state])
        )
      })
    }
  }

  function dispose(): void {
    unsubscribeWebState?.()
    unsubscribeWebState = null
    unsubscribeWebOpen?.()
    unsubscribeWebOpen = null
    unsubscribePreview?.()
    unsubscribePreview = null
  }

  function restore(
    session: WorkspaceSession | null,
    knowledgeBases: KnowledgeBaseDescriptor[]
  ): void {
    const knowledgeBaseIds = new Set(knowledgeBases.map((item) => item.id))
    if (!session) {
      const group = createGroup()
      layout.value = group
      activeGroupId.value = group.id
      return
    }
    const restored = sanitizeLayout(session.layout, knowledgeBaseIds)
    const restoredGroups = listGroups(restored)
    layout.value = restored
    activeGroupId.value = restoredGroups.some((group) => group.id === session.activeGroupId)
      ? session.activeGroupId
      : restoredGroups[0].id
    knowledgeSidebarWidth.value = session.knowledgeSidebarWidth
    navigatorSidebarWidth.value = session.navigatorSidebarWidth
    knowledgeSidebarCollapsed.value = session.knowledgeSidebarCollapsed
    navigatorSidebarCollapsed.value = session.navigatorSidebarCollapsed
    expandedTocNodes.value = session.expandedTocNodes
    trimToLimit()
  }

  function reset(): void {
    for (const group of groups.value) {
      for (const tab of group.tabs) {
        if (tab.type === 'web') void window.desk.web.close(tab.id)
      }
    }
    const group = createGroup()
    layout.value = group
    activeGroupId.value = group.id
    webStates.value = {}
  }

  function activate(groupId: string, tabId: string): void {
    activeGroupId.value = groupId
    layout.value = activateTabInLayout(layout.value, groupId, tabId)
  }

  function cycleActiveTab(direction: 'next' | 'previous'): void {
    const group = activeGroup.value
    if (!group) return
    layout.value = cycleTab(layout.value, group.id, direction)
  }

  function closableTabs(
    excludedIds = new Set<string>()
  ): Array<{ groupId: string; tab: EditorTab }> {
    return groups.value
      .flatMap((group) => group.tabs.map((tab) => ({ groupId: group.id, tab })))
      .filter(
        ({ tab }) => !tab.pinned && !excludedIds.has(tab.id) && (tab.type === 'web' || !tab.dirty)
      )
      .sort((left, right) => (left.tab.openedAt ?? 0) - (right.tab.openedAt ?? 0))
  }

  function ensureRoomForTab(excludedIds = new Set<string>()): void {
    while (tabCount.value >= maxOpenTabCount.value) {
      const oldest = closableTabs(excludedIds)[0]
      if (!oldest) {
        throw new Error(
          `标签数量已达到上限 ${maxOpenTabCount.value}，请先解除固定或保存并关闭一个标签。`
        )
      }
      close(oldest.groupId, oldest.tab.id)
    }
  }

  function trimToLimit(): void {
    while (tabCount.value > maxOpenTabCount.value) {
      const oldest = closableTabs()[0]
      if (!oldest) return
      close(oldest.groupId, oldest.tab.id)
    }
  }

  function keepOpen(tabId: string): void {
    const located = findTab(layout.value, tabId)
    if (located?.tab.type !== 'note' || !located.tab.preview) return
    located.tab.preview = false
    layout.value = { ...layout.value }
  }

  function setPinned(tabId: string, pinned: boolean): void {
    const located = findTab(layout.value, tabId)
    if (!located) return
    located.tab.pinned = pinned
    if (located.tab.type === 'note' && pinned) located.tab.preview = false
    layout.value = { ...layout.value }
  }

  function togglePinned(tabId: string): void {
    const located = findTab(layout.value, tabId)
    if (located) setPinned(tabId, !located.tab.pinned)
  }

  function setNoteDirty(knowledgeBaseId: string, noteUuid: string, dirty: boolean): void {
    let changed = false
    for (const group of groups.value) {
      for (const tab of group.tabs) {
        if (
          tab.type === 'note' &&
          tab.knowledgeBaseId === knowledgeBaseId &&
          tab.noteUuid === noteUuid
        ) {
          tab.dirty = dirty
          if (dirty) tab.preview = false
          changed = true
        }
      }
    }
    if (changed) layout.value = { ...layout.value }
  }

  function openNote(
    knowledgeBase: KnowledgeBaseDescriptor,
    noteUuid: string,
    title: string,
    viewMode: NoteViewMode,
    split?: SplitPlacement,
    openBehavior: 'preview' | 'permanent' = 'preview'
  ): string {
    const targetGroup = activeGroup.value
    if (!split && targetGroup) {
      const existing = targetGroup.tabs.find(
        (tab) =>
          tab.type === 'note' &&
          tab.knowledgeBaseId === knowledgeBase.id &&
          tab.noteUuid === noteUuid
      )
      if (existing) {
        activate(targetGroup.id, existing.id)
        if (openBehavior === 'permanent') keepOpen(existing.id)
        return existing.id
      }
    }

    const tab: NoteEditorTab = {
      id: createId('note'),
      type: 'note',
      knowledgeBaseId: knowledgeBase.id,
      knowledgeBaseName: knowledgeBase.displayName,
      noteUuid,
      title,
      icon: knowledgeBase.icon,
      viewMode,
      preview: openBehavior === 'preview',
      pinned: false,
      openedAt: Date.now(),
      dirty: false
    }
    if (split) {
      const currentGroupId = activeGroupId.value
      const excluded = new Set(activeTab.value ? [activeTab.value.id] : [])
      ensureRoomForTab(excluded)
      const targetGroupId = findGroup(layout.value, currentGroupId)
        ? currentGroupId
        : activeGroupId.value
      const result = splitGroupWithTab(layout.value, targetGroupId, split, tab)
      layout.value = result.layout
      activeGroupId.value = result.groupId
    } else {
      const previewTab = activeGroup.value?.tabs.find(
        (candidate) => candidate.type === 'note' && candidate.preview && !candidate.pinned
      )
      if (openBehavior === 'preview' && previewTab && activeGroup.value) {
        // Reuse the preview tab id so Vue keeps the pane mounted across note swaps
        // (EditorGroup keys panes by tab.id). Milkdown still remounts via noteUuid/content.
        const reused: NoteEditorTab = { ...tab, id: previewTab.id }
        const groupId = activeGroup.value.id
        layout.value = updateGroup(layout.value, groupId, (group) => ({
          ...group,
          tabs: group.tabs.map((candidate) =>
            candidate.id === previewTab.id ? reused : candidate
          ),
          activeTabId: reused.id
        }))
        return reused.id
      }
      ensureRoomForTab()
      layout.value = insertTab(layout.value, activeGroupId.value, tab)
    }
    return tab.id
  }

  function openWeb(url = DEFAULT_WEB_URL, targetGroupId?: string): string {
    ensureRoomForTab()
    const tab: WebEditorTab = {
      id: createId('web'),
      type: 'web',
      url,
      title: url,
      pinned: false,
      openedAt: Date.now()
    }
    const groupId = targetGroupId ?? activeGroupId.value
    layout.value = insertTab(layout.value, groupId, tab)
    activeGroupId.value = groupId
    return tab.id
  }

  async function startPreview(knowledgeBaseId: string, noteDirName?: string): Promise<void> {
    const result = await window.desk.preview.start({ knowledgeBaseId, noteDirName })
    if (!result.ok) throw new Error(result.error.message)
    previewStates.value = {
      ...previewStates.value,
      [knowledgeBaseId]: result.value.state
    }
    if (result.value.url) openWeb(result.value.url)
  }

  async function stopPreview(knowledgeBaseId: string): Promise<void> {
    const result = await window.desk.preview.stop(knowledgeBaseId)
    if (!result.ok) throw new Error(result.error.message)
    previewStates.value = {
      ...previewStates.value,
      [knowledgeBaseId]: result.value
    }
  }

  function close(groupId: string, tabId: string): boolean {
    const located = findTab(layout.value, tabId)
    if (!located || located.tab.pinned) return false
    if (located?.tab.type === 'web') {
      void window.desk.web.close(tabId)
      const nextStates = { ...webStates.value }
      delete nextStates[tabId]
      webStates.value = nextStates
    }
    layout.value = collapseEmptyGroups(removeTab(layout.value, groupId, tabId))
    const remainingGroups = listGroups(layout.value)
    if (!remainingGroups.some((group) => group.id === activeGroupId.value)) {
      activeGroupId.value = remainingGroups[0].id
    }
    return true
  }

  function closeSavedNotes(): void {
    const targets = groups.value.flatMap((group) =>
      group.tabs
        .filter((tab) => tab.type === 'note' && !tab.dirty && !tab.pinned)
        .map((tab) => ({ groupId: group.id, tabId: tab.id }))
    )
    for (const target of targets) close(target.groupId, target.tabId)
  }

  function closeAllTabs(): void {
    const targets = groups.value.flatMap((group) =>
      group.tabs.filter((tab) => !tab.pinned).map((tab) => ({ groupId: group.id, tabId: tab.id }))
    )
    for (const target of targets) close(target.groupId, target.tabId)
  }

  function closeAllWebTabs(): void {
    const targets = groups.value.flatMap((group) =>
      group.tabs
        .filter((tab) => tab.type === 'web' && !tab.pinned)
        .map((tab) => ({ groupId: group.id, tabId: tab.id }))
    )
    for (const target of targets) close(target.groupId, target.tabId)
  }

  function closeNote(knowledgeBaseId: string, noteUuid: string): void {
    for (const group of [...groups.value]) {
      for (const tab of [...group.tabs]) {
        if (
          tab.type === 'note' &&
          tab.knowledgeBaseId === knowledgeBaseId &&
          tab.noteUuid === noteUuid
        ) {
          close(group.id, tab.id)
        }
      }
    }
  }

  function renameNote(knowledgeBaseId: string, noteUuid: string, title: string): void {
    let changed = false
    for (const group of groups.value) {
      for (const tab of group.tabs) {
        if (
          tab.type === 'note' &&
          tab.knowledgeBaseId === knowledgeBaseId &&
          tab.noteUuid === noteUuid
        ) {
          tab.title = title
          changed = true
        }
      }
    }
    if (changed) layout.value = { ...layout.value }
  }

  function setNoteViewMode(tabId: string, viewMode: NoteViewMode): void {
    const located = findTab(layout.value, tabId)
    if (located?.tab.type !== 'note') return
    located.tab.viewMode = viewMode
    layout.value = { ...layout.value }
  }

  function moveTab(tabId: string, targetGroupId: string, targetIndex?: number): void {
    const located = findTab(layout.value, tabId)
    if (!located) return
    let next = removeTab(layout.value, located.group.id, tabId)
    next = insertTab(next, targetGroupId, located.tab, targetIndex)
    layout.value = collapseEmptyGroups(next)
    activeGroupId.value = targetGroupId
  }

  function splitTab(tabId: string, targetGroupId: string, placement: SplitPlacement): void {
    const located = findTab(layout.value, tabId)
    if (!located) return
    const duplicate = located.group.id === targetGroupId
    if (duplicate) ensureRoomForTab(new Set([tabId]))
    const resolvedTargetGroupId = findGroup(layout.value, targetGroupId)
      ? targetGroupId
      : activeGroupId.value
    const tab = duplicate ? cloneTab(located.tab) : located.tab
    let next = layout.value
    if (!duplicate) next = removeTab(next, located.group.id, tabId)
    const result = splitGroupWithTab(next, resolvedTargetGroupId, placement, tab)
    layout.value = collapseEmptyGroups(result.layout)
    activeGroupId.value = result.groupId
  }

  function splitActive(placement: SplitPlacement): void {
    if (!activeTab.value) return
    splitTab(activeTab.value.id, activeGroupId.value, placement)
  }

  function resizeSplit(splitId: string, ratio: number): void {
    layout.value = setSplitRatio(layout.value, splitId, ratio)
  }

  function toSession(selectedKnowledgeBaseId: string | null): WorkspaceSession {
    const serializedLayout = JSON.parse(JSON.stringify(layout.value)) as EditorLayoutNode
    const serializedExpandedNodes = JSON.parse(JSON.stringify(expandedTocNodes.value)) as Record<
      string,
      string[]
    >
    return {
      version: 1,
      selectedKnowledgeBaseId,
      layout: serializedLayout,
      activeGroupId: activeGroupId.value,
      knowledgeSidebarWidth: knowledgeSidebarWidth.value,
      navigatorSidebarWidth: navigatorSidebarWidth.value,
      knowledgeSidebarCollapsed: knowledgeSidebarCollapsed.value,
      navigatorSidebarCollapsed: navigatorSidebarCollapsed.value,
      expandedTocNodes: serializedExpandedNodes
    }
  }

  return {
    layout,
    activeGroupId,
    activeGroup,
    activeTab,
    tabCount,
    groups,
    webStates,
    previewStates,
    knowledgeSidebarWidth,
    navigatorSidebarWidth,
    knowledgeSidebarCollapsed,
    navigatorSidebarCollapsed,
    expandedTocNodes,
    maxOpenTabCount,
    wrapTabs,
    configure,
    initializeWebEvents,
    dispose,
    restore,
    reset,
    activate,
    cycleActiveTab,
    openNote,
    openWeb,
    startPreview,
    stopPreview,
    close,
    closeSavedNotes,
    closeAllTabs,
    closeAllWebTabs,
    closeNote,
    renameNote,
    setNoteViewMode,
    setNoteDirty,
    keepOpen,
    setPinned,
    togglePinned,
    moveTab,
    splitTab,
    splitActive,
    resizeSplit,
    toSession
  }
})
