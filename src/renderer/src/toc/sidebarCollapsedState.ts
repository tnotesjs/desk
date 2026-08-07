/**
 * 侧边栏文件夹展开/折叠状态（localStorage）
 */

import { extractNoteIndexFromLink } from './sidebarDragLogic'

export interface SidebarCollapseNode {
  link?: string
  collapsed?: boolean
  tocLineIndex?: number
  items?: SidebarCollapseNode[]
}

export type CollapseStoreV2 = {
  v: 2
  entries: Record<string, boolean>
}

export function collapseKeyForNote(noteIndex: string): string {
  return `note:${noteIndex}`
}

export function collapseKeyForLine(tocLineIndex: number): string {
  return `line:${tocLineIndex}`
}

function getCollapseKey(item: SidebarCollapseNode): string | null {
  if (!item.items?.length) return null

  const noteIndex = extractNoteIndexFromLink(item.link)
  if (noteIndex) return collapseKeyForNote(noteIndex)

  if (item.tocLineIndex !== undefined) {
    return collapseKeyForLine(item.tocLineIndex)
  }

  return null
}

export function collectSidebarCollapsedState(
  items: SidebarCollapseNode[],
  result: Record<string, boolean> = {},
): Record<string, boolean> {
  for (const item of items) {
    const key = getCollapseKey(item)
    if (key) {
      result[key] = !!item.collapsed
    }
    if (item.items?.length) {
      collectSidebarCollapsedState(item.items, result)
    }
  }
  return result
}

export function normalizeCollapseStore(
  raw: unknown,
): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }

  const obj = raw as Record<string, unknown>

  if (obj.v === 2 && obj.entries && typeof obj.entries === 'object') {
    const entries = obj.entries as Record<string, unknown>
    const result: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(entries)) {
      if (/^(note:\d{4}|line:\d+)$/.test(key)) {
        result[key] = !!value
      }
    }
    return result
  }

  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (/^\d{4}$/.test(key)) {
      result[collapseKeyForNote(key)] = !!value
    }
  }
  return result
}

export function applySidebarCollapsedState<T extends SidebarCollapseNode>(
  items: T[],
  state: Record<string, boolean>,
): T[] {
  return items.map((item) => {
    const key = getCollapseKey(item)
    const next = { ...item }

    if (key && key in state) {
      next.collapsed = state[key]
    }

    if (item.items?.length) {
      next.items = applySidebarCollapsedState(item.items, state)
    }

    return next
  })
}

export function loadSidebarCollapsedState(
  storageKey: string,
): Record<string, boolean> {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}

    return normalizeCollapseStore(JSON.parse(raw) as unknown)
  } catch {
    return {}
  }
}

export function saveSidebarCollapsedState(
  storageKey: string,
  items: SidebarCollapseNode[],
): void {
  if (typeof window === 'undefined') return

  try {
    const payload: CollapseStoreV2 = {
      v: 2,
      entries: collectSidebarCollapsedState(items),
    }
    window.localStorage.setItem(storageKey, JSON.stringify(payload))
  } catch {
    // ignore quota / privacy mode
  }
}

export function mergeCollapseStore(
  base: Record<string, boolean>,
  patch: Record<string, boolean>,
): Record<string, boolean> {
  return { ...base, ...patch }
}

export function saveCollapseEntries(
  storageKey: string,
  entries: Record<string, boolean>,
): void {
  if (typeof window === 'undefined') return

  try {
    const payload: CollapseStoreV2 = { v: 2, entries }
    window.localStorage.setItem(storageKey, JSON.stringify(payload))
  } catch {
    // ignore quota / privacy mode
  }
}

export function getCollapseKeyForTreeItem(
  item: SidebarCollapseNode,
): string | null {
  return getCollapseKey(item)
}

export interface PostDropCollapseInput {
  action: 'moveAfter' | 'prependChild'
  target_uuid?: string
}

export interface PostDropCollapseMeta {
  sourceCollapseKey: string | null
  wasExpanded: boolean
  /** prependChild 目标为 folder:path 等时由调用方解析 */
  targetCollapseKey?: string | null
}

export function buildPostDropCollapsePatch(
  payload: PostDropCollapseInput,
  meta: PostDropCollapseMeta,
): Record<string, boolean> {
  const patch: Record<string, boolean> = {}

  if (payload.action === 'prependChild' && payload.target_uuid) {
    if (payload.target_uuid.startsWith('note:')) {
      patch[collapseKeyForNote(payload.target_uuid.slice(5))] = false
    } else if (payload.target_uuid.startsWith('line:')) {
      patch[collapseKeyForLine(Number(payload.target_uuid.slice(5)))] = false
    } else if (
      payload.target_uuid.startsWith('folder:') &&
      meta.targetCollapseKey
    ) {
      patch[meta.targetCollapseKey] = false
    }
  }

  if (
    payload.action === 'prependChild' &&
    meta.targetCollapseKey &&
    !(meta.targetCollapseKey in patch)
  ) {
    patch[meta.targetCollapseKey] = false
  }

  if (meta.wasExpanded && meta.sourceCollapseKey) {
    patch[meta.sourceCollapseKey] = false
  }

  return patch
}

const DEFAULT_SUPPRESS_ACTIVE_SCROLL_MS = 2000

export function shouldSuppressActiveItemScroll(
  storageKey: string,
  now = Date.now(),
): boolean {
  if (typeof window === 'undefined') return false

  try {
    const until = Number(window.sessionStorage.getItem(storageKey) || 0)
    return now < until
  } catch {
    return false
  }
}

export function suppressActiveItemScroll(
  storageKey: string,
  durationMs = DEFAULT_SUPPRESS_ACTIVE_SCROLL_MS,
  now = Date.now(),
): void {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.setItem(
      storageKey,
      String(now + durationMs),
    )
  } catch {
    // ignore quota / privacy mode
  }
}
