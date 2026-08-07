/**
 * vitepress/components/Layout/sidebarDragLogic.ts
 *
 * 侧边栏树形拖拽纯逻辑：flat 列表、落点投影、树移动。
 */

import { computeSidebarNodeId } from './tocNodeId'

import type { DropIntent } from './sidebarHitTest'

export interface SidebarTreeItem {
  text: string
  link?: string
  items?: SidebarTreeItem[]
  collapsed?: boolean
  folderPath?: string[]
  tocLineIndex?: number
  /** dev 拖拽 nodeId */
  nodeId?: string
  /** 拖拽预览占位槽（非真实 TOC 项） */
  isDragPlaceholder?: boolean
  /** 拖拽中：源项原位保留空间（语雀式） */
  isDragSourceSlot?: boolean
}

export interface FlatSidebarRow {
  kind: 'folder' | 'note'
  noteIndex: string | null
  folderPath: string[] | null
  tocLineIndex: number | null
  nodeId: string | null
  depth: number
  parentNoteIndex: string | null
  parentFolderPath: string[] | null
  hasChildren: boolean
  collapsed: boolean
}

export type DropPlacement = 'before' | 'after' | 'inside'

export interface DropTarget {
  targetNoteIndex?: string
  targetFolderPath?: string[]
  targetTocLineIndex?: number
  placement: DropPlacement
  projectedDepth: number
}

export type DropIndicatorMode = 'line' | 'inside' | 'tail-rail' | 'root-prepend'

export interface DropIndicatorMeta {
  mode: DropIndicatorMode
  depthLevels: number[]
  activeDepth: number
}

export interface DropProjectionResult {
  target: DropTarget
  indicator: DropIndicatorMeta
}

export interface DropProjectionConfig {
  maxDepth: number
  indentSize: number
  draggedSubtreeDepthSpan: number
}

export const SIDEBAR_ROW_BASE_PADDING = 6
export const SIDEBAR_ARROW_WIDTH = 20
/** 语雀式侧边栏固定行高（px） */
export const SIDEBAR_ROW_HEIGHT = 36
/** 语雀式侧边栏固定层级缩进（px） */
export const SIDEBAR_INDENT_SIZE = 28

export interface ReorderPayload {
  dragType: 'note' | 'folder'
  dragTocLineIndex: number
  noteIndex?: string
  targetType: 'group' | 'note'
  targetNoteIndex?: string
  targetFolderPath?: string[]
  targetTocLineIndex?: number
  placement: DropPlacement
}

export interface YuqueReorderPayload {
  node_uuid: string
  action: 'moveAfter' | 'prependChild'
  /** 拖入文件夹时必填；拖到列表顶（prepend 到根容器）时省略，与语雀一致 */
  target_uuid?: string
  /** legacy fallback */
  dragTocLineIndex?: number
  placement?: DropPlacement
  targetTocLineIndex?: number
}

export interface DragSource {
  kind: 'note' | 'folder'
  tocLineIndex: number
  noteIndex?: string
}

export function extractNoteIndexFromLink(link?: string): string | null {
  if (!link) return null
  const match = link.match(/\/notes\/(\d{4})\./)
  return match ? match[1] : null
}

export interface FlattenVisibleOptions {
  /** 拖拽预览：将该 TOC 行子树在 flat 中视为折叠（仅显示一行） */
  forceCollapsedTocLineIndex?: number | null
}

export function flattenVisibleSidebar(
  items: SidebarTreeItem[],
  depth = 0,
  parentNoteIndex: string | null = null,
  parentFolderPath: string[] | null = null,
  options: FlattenVisibleOptions = {},
): FlatSidebarRow[] {
  const result: FlatSidebarRow[] = []
  const forceCollapsed = options.forceCollapsedTocLineIndex

  for (const item of items) {
    if (item.isDragPlaceholder) continue

    const noteIndex = extractNoteIndexFromLink(item.link)
    const hasChildren = !!(item.items && item.items.length > 0)
    const treatAsCollapsed =
      !!item.collapsed ||
      (forceCollapsed !== undefined &&
        forceCollapsed !== null &&
        item.tocLineIndex === forceCollapsed)

    const isFolderLine =
      !noteIndex && (hasChildren || !!(item.folderPath && item.folderPath.length > 0))

    if (isFolderLine) {
      const folderPath =
        item.folderPath ??
        [...(parentFolderPath ?? []), item.text.replace(/^[✅⏰]\s*/, '')]
      result.push({
        kind: 'folder',
        noteIndex: null,
        folderPath,
        tocLineIndex: item.tocLineIndex ?? null,
        nodeId: item.nodeId ?? computeSidebarNodeId(item),
        depth,
        parentNoteIndex,
        parentFolderPath,
        hasChildren,
        collapsed: !!item.collapsed,
      })

      if (hasChildren && !treatAsCollapsed) {
        result.push(
          ...flattenVisibleSidebar(
            item.items!,
            depth + 1,
            null,
            folderPath,
            options,
          ),
        )
      }
      continue
    }

    if (!noteIndex) continue

    result.push({
      kind: 'note',
      noteIndex,
      folderPath: null,
      tocLineIndex: item.tocLineIndex ?? null,
      nodeId: item.nodeId ?? computeSidebarNodeId(item),
      depth,
      parentNoteIndex,
      parentFolderPath,
      hasChildren,
      collapsed: !!item.collapsed,
    })

    if (hasChildren && !treatAsCollapsed) {
      result.push(
        ...flattenVisibleSidebar(
          item.items!,
          depth + 1,
          noteIndex,
          parentFolderPath,
          options,
        ),
      )
    }
  }

  return result
}

export function getSubtreeDepthSpan(item: SidebarTreeItem): number {
  if (!item.items?.length) return 0
  return 1 + Math.max(...item.items.map(getSubtreeDepthSpan))
}

export function findTreeItem(
  items: SidebarTreeItem[],
  noteIndex: string,
): SidebarTreeItem | null {
  for (const item of items) {
    if (extractNoteIndexFromLink(item.link) === noteIndex) return item
    if (item.items?.length) {
      const found = findTreeItem(item.items, noteIndex)
      if (found) return found
    }
  }
  return null
}

export function isDescendantInTree(
  items: SidebarTreeItem[],
  ancestorNoteIndex: string,
  candidateNoteIndex: string,
): boolean {
  const ancestor = findTreeItem(items, ancestorNoteIndex)
  if (!ancestor?.items?.length) return false

  function walk(nodes: SidebarTreeItem[]): boolean {
    for (const node of nodes) {
      const id = extractNoteIndexFromLink(node.link)
      if (id === candidateNoteIndex) return true
      if (node.items?.length && walk(node.items)) return true
    }
    return false
  }

  return walk(ancestor.items)
}

export function isInvalidDrop(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  dragSource: DragSource,
  target: DropTarget,
  config: DropProjectionConfig,
): boolean {
  if (
    target.targetTocLineIndex !== undefined &&
    target.targetTocLineIndex === dragSource.tocLineIndex
  ) {
    return true
  }

  const dragFlatIndex = flat.findIndex(
    (row) => row.tocLineIndex === dragSource.tocLineIndex,
  )
  if (target.targetTocLineIndex !== undefined && dragFlatIndex >= 0) {
    const targetFlatIndex = flat.findIndex(
      (row) => row.tocLineIndex === target.targetTocLineIndex,
    )
    if (
      targetFlatIndex >= 0 &&
      isFlatRowInDragSubtree(flat, dragFlatIndex, targetFlatIndex)
    ) {
      return true
    }
  }

  if (
    dragSource.noteIndex &&
    target.targetNoteIndex &&
    dragSource.noteIndex === target.targetNoteIndex
  ) {
    return true
  }
  if (
    dragSource.noteIndex &&
    target.targetNoteIndex &&
    isDescendantInTree(tree, dragSource.noteIndex, target.targetNoteIndex)
  ) {
    return true
  }

  if (config.maxDepth > 0 && Number.isFinite(config.maxDepth)) {
    if (target.placement === 'inside') {
      const deepestIndent =
        target.projectedDepth + config.draggedSubtreeDepthSpan
      if (deepestIndent >= config.maxDepth) return true
    } else {
      const maxRootDepth = config.maxDepth - 1 - config.draggedSubtreeDepthSpan
      if (target.projectedDepth > maxRootDepth) return true
    }
  }

  if (target.projectedDepth < 0) return true

  return false
}

function isFlatRowInDragSubtree(
  flat: FlatSidebarRow[],
  dragFlatIndex: number,
  candidateFlatIndex: number,
): boolean {
  if (candidateFlatIndex === dragFlatIndex) return true
  const dragRow = flat[dragFlatIndex]
  if (!dragRow || candidateFlatIndex < dragFlatIndex) return false

  for (let i = dragFlatIndex + 1; i <= candidateFlatIndex; i++) {
    if (flat[i].depth <= dragRow.depth) {
      return false
    }
  }

  return candidateFlatIndex > dragFlatIndex
}

function hasDepthLimit(config: DropProjectionConfig): boolean {
  return config.maxDepth > 0 && Number.isFinite(config.maxDepth)
}

function getMaxRootDepth(
  config: DropProjectionConfig,
  overDepth: number,
): number {
  if (!hasDepthLimit(config)) return overDepth
  return Math.max(
    0,
    config.maxDepth - 1 - config.draggedSubtreeDepthSpan,
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function findRowAtDepth(
  flat: FlatSidebarRow[],
  startIndex: number,
  depth: number,
): FlatSidebarRow | null {
  for (let i = startIndex; i >= 0; i--) {
    if (flat[i].depth === depth) return flat[i]
    if (flat[i].depth < depth) break
  }
  return null
}

/** 是否为同级块末行 after 落点（语雀：仅此时展示上级导轨） */
export function isTailAfterDrop(
  flat: FlatSidebarRow[],
  overIndex: number,
  verticalPlacement: 'before' | 'after',
  dragNoteIndex?: string | null,
  dragTocLineIndex?: number | null,
): boolean {
  if (verticalPlacement !== 'after') return false

  const overRow = flat[overIndex]
  if (!overRow) return false

  const next = flat[overIndex + 1]
  if (!next) return true

  if (next.depth < overRow.depth) return true

  if (
    dragTocLineIndex !== undefined &&
    dragTocLineIndex !== null &&
    next.tocLineIndex === dragTocLineIndex
  ) {
    const dragRow = findFlatRowByTocLineIndex(flat, dragTocLineIndex)
    if (
      dragRow &&
      dragRow.depth === overRow.depth &&
      dragRow.parentNoteIndex === overRow.parentNoteIndex &&
      folderPathsEqual(dragRow.parentFolderPath, overRow.parentFolderPath)
    ) {
      return !overRow.hasChildren
    }
    return (
      overRow.depth > 0 &&
      dragRow?.parentNoteIndex === overRow.parentNoteIndex &&
      folderPathsEqual(dragRow.parentFolderPath, overRow.parentFolderPath)
    )
  }

  if (dragNoteIndex && next.noteIndex === dragNoteIndex) {
    const dragRow = findFlatRowByNoteIndex(flat, dragNoteIndex)
    if (
      dragRow &&
      dragRow.depth === overRow.depth &&
      dragRow.parentNoteIndex === overRow.parentNoteIndex
    ) {
      // 紧邻同级：hover 文件夹父行 → 不算 tail；hover 前一条子笔记 → 仍走 tail 导轨
      return !overRow.hasChildren
    }
    return (
      overRow.depth > 0 &&
      dragRow?.parentNoteIndex === overRow.parentNoteIndex
    )
  }

  return false
}

/** 拖拽项是否为 flat 列表中紧邻的下一行同级笔记 */
function isImmediateNextSibling(
  flat: FlatSidebarRow[],
  overIndex: number,
  dragSource: DragSource,
): boolean {
  const overRow = flat[overIndex]
  const next = flat[overIndex + 1]
  if (!overRow || !next) return false

  const dragRow = findFlatRowByTocLineIndex(flat, dragSource.tocLineIndex)
  if (!dragRow || next.tocLineIndex !== dragSource.tocLineIndex) return false

  return (
    dragRow.depth === overRow.depth &&
    dragRow.parentNoteIndex === overRow.parentNoteIndex &&
    folderPathsEqual(dragRow.parentFolderPath, overRow.parentFolderPath)
  )
}

function tryInsideFirstForExternalDrag(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  dragSource: DragSource,
  parentRow: FlatSidebarRow,
  config: DropProjectionConfig,
): DropProjectionResult | null {
  const dragRow = findFlatRowByTocLineIndex(flat, dragSource.tocLineIndex)
  if (!dragRow) return null

  const isExternal = isDragExternalToTargetParent(flat, dragRow, parentRow)
  if (!isExternal) return null

  const target = buildInsideTarget(parentRow)
  return finalizeProjection(
    tree,
    flat,
    dragSource,
    target,
    buildInsideIndicator(target.projectedDepth),
    config,
  )
}

/** 语雀：外部拖入折叠父级整行 → prependChild（不区分 before/after 半区） */
function tryPrependInsideExternalCollapsedParent(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  dragSource: DragSource,
  parentRow: FlatSidebarRow,
  config: DropProjectionConfig,
  verticalPlacement: 'before' | 'after',
): DropProjectionResult | null {
  if (parentRow.kind !== 'folder' || !parentRow.collapsed) return null
  if (verticalPlacement === 'before' && !parentRow.hasChildren) return null
  return tryInsideFirstForExternalDrag(
    tree,
    flat,
    dragSource,
    parentRow,
    config,
  )
}

/** 语雀：外部笔记/分组拖入笔记行 → prependChild（整行有效，不要求右缩进） */
function tryPrependInsideExternalNoteRow(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  dragSource: DragSource,
  overIndex: number,
  overRow: FlatSidebarRow,
  verticalPlacement: 'before' | 'after',
  config: DropProjectionConfig,
): DropProjectionResult | null {
  if (
    !shouldPrependInsideExternalNoteRow(
      flat,
      dragSource,
      overIndex,
      overRow,
      verticalPlacement,
    )
  ) {
    return null
  }

  const dragRow = findFlatRowByTocLineIndex(flat, dragSource.tocLineIndex)
  if (!dragRow) return null

  const target = buildInsideTarget(overRow)
  return finalizeProjection(
    tree,
    flat,
    dragSource,
    target,
    buildInsideIndicator(target.projectedDepth),
    config,
  )
}

export function isDragExternalToTargetParent(
  _flat: FlatSidebarRow[],
  dragRow: FlatSidebarRow,
  parentRow: FlatSidebarRow,
): boolean {
  if (parentRow.kind === 'folder' && parentRow.folderPath) {
    return !folderPathsEqual(dragRow.parentFolderPath, parentRow.folderPath)
  }
  if (parentRow.noteIndex) {
    return dragRow.parentNoteIndex !== parentRow.noteIndex
  }
  return true
}

/** 是否应将外部拖拽整行判为拖入笔记行（prependChild / inside） */
export function shouldPrependInsideExternalNoteRow(
  flat: FlatSidebarRow[],
  dragSource: DragSource,
  overIndex: number,
  overRow: FlatSidebarRow,
  verticalPlacement: 'before' | 'after',
): boolean {
  if (!overRow.noteIndex) return false

  const dragIndex = flat.findIndex(
    (row) => row.tocLineIndex === dragSource.tocLineIndex,
  )
  if (dragIndex < 0) return false

  const dragRow = flat[dragIndex]
  if (!isDragExternalToTargetParent(flat, dragRow, overRow)) return false

  if (dragSource.kind === 'folder') return true

  if (verticalPlacement === 'before') return false

  const nextRow = flat[overIndex + 1]
  if (nextRow?.tocLineIndex === dragSource.tocLineIndex) {
    return overRow.depth === 0 && dragRow.depth === 0
  }

  if (
    isTailAfterDrop(
      flat,
      overIndex,
      verticalPlacement,
      dragSource.noteIndex,
      dragSource.tocLineIndex,
    )
  ) {
    return false
  }

  return true
}

/** 由指针绝对 X 计算目标 depth（0..maxSelectableDepth） */
export function depthFromClientX(
  clientX: number,
  navLeft: number,
  indentSize: number,
  maxSelectableDepth: number,
): number {
  const base = navLeft + SIDEBAR_ROW_BASE_PADDING + SIDEBAR_ARROW_WIDTH
  const raw = Math.round((clientX - base) / indentSize)
  return clamp(raw, 0, maxSelectableDepth)
}

export function getTailDepthLevels(overDepth: number): number[] {
  return Array.from({ length: overDepth + 1 }, (_, index) => index)
}

export function getDepthContentLeft(depth: number, indentSize: number): number {
  return SIDEBAR_ROW_BASE_PADDING + depth * indentSize + SIDEBAR_ARROW_WIDTH
}

/** 尾行 after：在选定 depth 对应 ancestor 子树末尾插入 */
export function resolveTailDropTarget(
  flat: FlatSidebarRow[],
  overIndex: number,
  targetDepth: number,
): DropTarget {
  const overRow = flat[overIndex]
  const anchor =
    targetDepth < overRow.depth
      ? findRowAtDepth(flat, overIndex, targetDepth) ?? overRow
      : overRow

  return {
    targetNoteIndex: anchor.noteIndex ?? undefined,
    targetFolderPath:
      anchor.kind === 'folder' ? anchor.folderPath ?? undefined : undefined,
    targetTocLineIndex: anchor.tocLineIndex ?? undefined,
    placement: 'after',
    projectedDepth: targetDepth,
  }
}

function findFlatRowByTocLineIndex(
  flat: FlatSidebarRow[],
  tocLineIndex: number,
): FlatSidebarRow | undefined {
  return flat.find((row) => row.tocLineIndex === tocLineIndex)
}

function findFlatRowByNoteIndex(
  flat: FlatSidebarRow[],
  noteIndex: string,
): FlatSidebarRow | undefined {
  return flat.find((row) => row.noteIndex === noteIndex)
}

function findFlatRowByFolderPath(
  flat: FlatSidebarRow[],
  folderPath: string[],
): FlatSidebarRow | undefined {
  const key = folderPath.join('/')
  return flat.find(
    (row) => row.kind === 'folder' && row.folderPath?.join('/') === key,
  )
}

function folderPathsEqual(
  left: string[] | null | undefined,
  right: string[] | null | undefined,
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.join('/') === right.join('/')
}

/** 拖拽项不是目标父节点的直接子笔记（从外部拖入文件夹） */
export function isDragExternalToParent(
  flat: FlatSidebarRow[],
  dragNoteIndex: string,
  parentNoteIndex: string,
): boolean {
  const dragRow = findFlatRowByNoteIndex(flat, dragNoteIndex)
  if (!dragRow || dragNoteIndex === parentNoteIndex) return false
  return dragRow.parentNoteIndex !== parentNoteIndex
}

function buildInsideTarget(parentRow: FlatSidebarRow): DropTarget {
  const base = {
    placement: 'inside' as const,
    projectedDepth: parentRow.depth + 1,
    targetTocLineIndex: parentRow.tocLineIndex ?? undefined,
  }

  if (parentRow.kind === 'folder' && parentRow.folderPath) {
    return {
      ...base,
      targetFolderPath: parentRow.folderPath,
    }
  }

  return {
    ...base,
    targetNoteIndex: parentRow.noteIndex ?? undefined,
  }
}

function buildLineIndicator(depth: number): DropIndicatorMeta {
  return {
    mode: 'line',
    depthLevels: [depth],
    activeDepth: depth,
  }
}

function buildInsideIndicator(depth: number): DropIndicatorMeta {
  return {
    mode: 'inside',
    depthLevels: [depth],
    activeDepth: depth,
  }
}

function buildTailIndicator(overDepth: number, activeDepth: number): DropIndicatorMeta {
  return {
    mode: 'tail-rail',
    depthLevels: getTailDepthLevels(overDepth),
    activeDepth,
  }
}

function finalizeProjection(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  dragSource: DragSource,
  target: DropTarget,
  indicator: DropIndicatorMeta,
  config: DropProjectionConfig,
): DropProjectionResult | null {
  if (isInvalidDrop(tree, flat, dragSource, target, config)) return null
  return { target, indicator }
}

/**
 * 根据 hover 行、垂直落点与指针位置计算 TOC 移动目标。
 */
export function getDropProjection(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  dragSource: DragSource,
  overIndex: number,
  verticalPlacement: 'before' | 'after',
  config: DropProjectionConfig,
  pointer: {
    offsetX: number
    clientX: number
    navLeft: number
  },
): DropProjectionResult | null {
  if (overIndex < 0 || overIndex >= flat.length) return null

  const overRow = flat[overIndex]
  const dragRow = findFlatRowByTocLineIndex(flat, dragSource.tocLineIndex)
  if (!overRow || !dragRow) return null
  if (overRow.tocLineIndex === dragSource.tocLineIndex) return null

  const dragNoteIndex = dragSource.noteIndex ?? ''
  const maxRootDepth = getMaxRootDepth(config, overRow.depth)

  const collapsedInside = tryPrependInsideExternalCollapsedParent(
    tree,
    flat,
    dragSource,
    overRow,
    config,
    verticalPlacement,
  )
  if (collapsedInside) return collapsedInside

  const insideExternalNote = tryPrependInsideExternalNoteRow(
    tree,
    flat,
    dragSource,
    overIndex,
    overRow,
    verticalPlacement,
    config,
  )
  if (insideExternalNote) return insideExternalNote

  if (
    isTailAfterDrop(
      flat,
      overIndex,
      verticalPlacement,
      dragNoteIndex || null,
      dragSource.tocLineIndex,
    )
  ) {
    const pointerDepth = clamp(
      depthFromClientX(
        pointer.clientX,
        pointer.navLeft,
        config.indentSize,
        overRow.depth,
      ),
      0,
      Math.min(overRow.depth, maxRootDepth),
    )

    const parentRow = overRow.parentNoteIndex
      ? findFlatRowByNoteIndex(flat, overRow.parentNoteIndex)
      : overRow.parentFolderPath
        ? findFlatRowByFolderPath(flat, overRow.parentFolderPath)
        : undefined
    const nextRow = flat[overIndex + 1]
    const draggingLastChildFromTail =
      !!parentRow &&
      !!nextRow &&
      nextRow.tocLineIndex === dragSource.tocLineIndex &&
      (parentRow.noteIndex
        ? dragRow.parentNoteIndex === parentRow.noteIndex
        : folderPathsEqual(dragRow.parentFolderPath, parentRow.folderPath))
    const externalSameLevel =
      !!parentRow &&
      isDragExternalToTargetParent(flat, dragRow, parentRow) &&
      dragRow.depth <= parentRow.depth

    let targetDepth = pointerDepth
    if (draggingLastChildFromTail && parentRow) {
      targetDepth =
        pointerDepth <= parentRow.depth ? parentRow.depth : pointerDepth
    } else if (externalSameLevel && parentRow) {
      targetDepth =
        pointerDepth <= parentRow.depth ? parentRow.depth : overRow.depth
    } else if (
      pointerDepth === overRow.depth &&
      (overRow.parentNoteIndex || overRow.parentFolderPath)
    ) {
      const parentForInside = overRow.parentNoteIndex
        ? findFlatRowByNoteIndex(flat, overRow.parentNoteIndex)
        : overRow.parentFolderPath
          ? findFlatRowByFolderPath(flat, overRow.parentFolderPath)
          : undefined
      if (parentForInside) {
        const insideFirst = tryInsideFirstForExternalDrag(
          tree,
          flat,
          dragSource,
          parentForInside,
          config,
        )
        if (insideFirst) {
          return insideFirst
        }
      }
    }

    const target = resolveTailDropTarget(flat, overIndex, targetDepth)
    return finalizeProjection(
      tree,
      flat,
      dragSource,
      target,
      buildTailIndicator(overRow.depth, targetDepth),
      config,
    )
  }

  if (verticalPlacement === 'before') {
    const target: DropTarget =
      overRow.kind === 'folder' && overRow.folderPath
        ? {
            targetFolderPath: overRow.folderPath,
            targetTocLineIndex: overRow.tocLineIndex ?? undefined,
            placement: 'before',
            projectedDepth: overRow.depth,
          }
        : {
            targetNoteIndex: overRow.noteIndex ?? undefined,
            targetTocLineIndex: overRow.tocLineIndex ?? undefined,
            placement: 'before',
            projectedDepth: overRow.depth,
          }
    return finalizeProjection(
      tree,
      flat,
      dragSource,
      target,
      buildLineIndicator(overRow.depth),
      config,
    )
  }

  const depthDelta = Math.round(pointer.offsetX / config.indentSize)
  const canNestInside =
    depthDelta >= 1 &&
    overRow.depth + 1 <= maxRootDepth &&
    (!hasDepthLimit(config) || overRow.depth + 1 < config.maxDepth)

  if (canNestInside) {
    const target = buildInsideTarget(overRow)
    return finalizeProjection(
      tree,
      flat,
      dragSource,
      target,
      buildInsideIndicator(target.projectedDepth),
      config,
    )
  }

  if (
    overRow.hasChildren &&
    depthDelta < 1 &&
    isImmediateNextSibling(flat, overIndex, dragSource)
  ) {
    const insideFirst = tryInsideFirstForExternalDrag(
      tree,
      flat,
      dragSource,
      overRow,
      config,
    )
    if (insideFirst) return insideFirst
  }

  const target: DropTarget =
    overRow.kind === 'folder' && overRow.folderPath
      ? {
          targetFolderPath: overRow.folderPath,
          targetTocLineIndex: overRow.tocLineIndex ?? undefined,
          placement: 'after',
          projectedDepth: overRow.depth,
        }
      : {
          targetNoteIndex: overRow.noteIndex ?? undefined,
          targetTocLineIndex: overRow.tocLineIndex ?? undefined,
          placement: 'after',
          projectedDepth: overRow.depth,
        }
  return finalizeProjection(
    tree,
    flat,
    dragSource,
    target,
    buildLineIndicator(overRow.depth),
    config,
  )
}

export function toReorderPayload(
  dragSource: DragSource,
  target: DropTarget,
): ReorderPayload {
  const isFolderTarget =
    !!target.targetFolderPath?.length && !target.targetNoteIndex

  return {
    dragType: dragSource.kind,
    dragTocLineIndex: dragSource.tocLineIndex,
    noteIndex: dragSource.noteIndex,
    targetType:
      target.placement === 'inside' || isFolderTarget ? 'group' : 'note',
    targetTocLineIndex: target.targetTocLineIndex,
    targetFolderPath: target.targetFolderPath,
    targetNoteIndex: target.targetNoteIndex,
    placement: target.placement,
  }
}

interface RemoveResult {
  tree: SidebarTreeItem[]
  removed: SidebarTreeItem | null
}

function cloneSidebarTree(items: SidebarTreeItem[]): SidebarTreeItem[] {
  return items.map((item) => ({
    ...item,
    items: item.items ? cloneSidebarTree(item.items) : undefined,
  }))
}

function itemMatchesDropTarget(
  item: SidebarTreeItem,
  target: DropTarget,
): boolean {
  if (
    target.targetTocLineIndex !== undefined &&
    item.tocLineIndex === target.targetTocLineIndex
  ) {
    return true
  }
  if (target.targetNoteIndex) {
    return extractNoteIndexFromLink(item.link) === target.targetNoteIndex
  }
  if (target.targetFolderPath?.length && !item.link) {
    const path =
      item.folderPath ??
      [item.text.replace(/^[✅⏰]\s*/, '')]
    return path.join('/') === target.targetFolderPath.join('/')
  }
  return false
}

export function removeFromListByTocLineIndex(
  items: SidebarTreeItem[],
  tocLineIndex: number,
): RemoveResult {
  const tree = cloneSidebarTree(items)

  for (let i = 0; i < tree.length; i++) {
    if (tree[i].tocLineIndex === tocLineIndex) {
      const [removed] = tree.splice(i, 1)
      return { tree, removed }
    }

    if (tree[i].items?.length) {
      const nested = removeFromListByTocLineIndex(tree[i].items!, tocLineIndex)
      if (nested.removed) {
        tree[i] = { ...tree[i], items: nested.tree }
        return { tree, removed: nested.removed }
      }
    }
  }

  return { tree, removed: null }
}

function insertRelativeToTarget(
  items: SidebarTreeItem[],
  target: DropTarget,
  subtree: SidebarTreeItem,
  options?: { expandInside?: boolean },
): SidebarTreeItem[] | null {
  const tree = cloneSidebarTree(items)
  const expandInside = options?.expandInside !== false

  for (let i = 0; i < tree.length; i++) {
    if (itemMatchesDropTarget(tree[i], target)) {
      if (target.placement === 'inside') {
        tree[i] = {
          ...tree[i],
          items: [subtree, ...(tree[i].items ?? [])],
          ...(expandInside ? { collapsed: false } : {}),
        }
        return tree
      }

      if (target.placement === 'before') {
        tree.splice(i, 0, subtree)
        return tree
      }

      tree.splice(i + 1, 0, subtree)
      return tree
    }

    if (tree[i].items?.length) {
      const nested = insertRelativeToTarget(
        tree[i].items!,
        target,
        subtree,
        options,
      )
      if (nested) {
        tree[i] = { ...tree[i], items: nested }
        return tree
      }
    }
  }

  return null
}

function removeFromList(
  items: SidebarTreeItem[],
  noteIndex: string,
): RemoveResult {
  const tree: SidebarTreeItem[] = items.map((item) => ({
    ...item,
    items: item.items ? [...item.items] : undefined,
  }))

  for (let i = 0; i < tree.length; i++) {
    const id = extractNoteIndexFromLink(tree[i].link)
    if (id === noteIndex) {
      const [removed] = tree.splice(i, 1)
      return { tree, removed }
    }

    if (tree[i].items?.length) {
      const nested = removeFromList(tree[i].items!, noteIndex)
      if (nested.removed) {
        tree[i] = { ...tree[i], items: nested.tree }
        return { tree, removed: nested.removed }
      }
    }
  }

  return { tree, removed: null }
}

function insertIntoList(
  items: SidebarTreeItem[],
  targetNoteIndex: string,
  placement: DropPlacement,
  subtree: SidebarTreeItem,
): SidebarTreeItem[] | null {
  const tree: SidebarTreeItem[] = items.map((item) => ({
    ...item,
    items: item.items ? [...item.items] : undefined,
  }))

  for (let i = 0; i < tree.length; i++) {
    const id = extractNoteIndexFromLink(tree[i].link)
    if (id === targetNoteIndex) {
      if (placement === 'inside') {
        const nextItems = [subtree, ...(tree[i].items ?? [])]
        tree[i] = { ...tree[i], items: nextItems, collapsed: false }
        return tree
      }

      if (placement === 'before') {
        tree.splice(i, 0, subtree)
        return tree
      }

      tree.splice(i + 1, 0, subtree)
      return tree
    }

    if (tree[i].items?.length) {
      const nested = insertIntoList(
        tree[i].items!,
        targetNoteIndex,
        placement,
        subtree,
      )
      if (nested) {
        tree[i] = { ...tree[i], items: nested }
        return tree
      }
    }
  }

  return null
}

export function getProjectionFingerprint(
  projection: DropProjectionResult,
): string {
  const { target, indicator } = projection
  return [
    target.placement,
    target.projectedDepth,
    target.targetNoteIndex ?? '',
    target.targetTocLineIndex ?? '',
    target.targetFolderPath?.join('/') ?? '',
    indicator.mode,
    indicator.activeDepth,
    indicator.depthLevels.join(','),
  ].join('|')
}

function findTreeItemByNodeId(
  items: SidebarTreeItem[],
  nodeId: string,
): SidebarTreeItem | null {
  for (const node of items) {
    const id = node.nodeId ?? computeSidebarNodeId(node)
    if (id === nodeId) return node
    if (node.items?.length) {
      const found = findTreeItemByNodeId(node.items, nodeId)
      if (found) return found
    }
  }
  return null
}

function findSiblingContext(
  items: SidebarTreeItem[],
  tocLineIndex: number,
): { list: SidebarTreeItem[]; index: number } | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].tocLineIndex === tocLineIndex) {
      return { list: items, index: i }
    }
    if (items[i].items?.length) {
      const found = findSiblingContext(items[i].items!, tocLineIndex)
      if (found) return found
    }
  }
  return null
}

export function isDropIntentNoOp(
  tree: SidebarTreeItem[],
  sourceTocLineIndex: number,
  intent: DropIntent,
): boolean {
  if (intent.isRootPrepend) {
    const sourceCtx = findSiblingContext(tree, sourceTocLineIndex)
    return !!sourceCtx && sourceCtx.list === tree && sourceCtx.index === 0
  }

  const sourceCtx = findSiblingContext(tree, sourceTocLineIndex)
  if (!sourceCtx) return false

  if (!intent.targetNodeId) return false

  const targetItem = findTreeItemByNodeId(tree, intent.targetNodeId)
  if (!targetItem || targetItem.tocLineIndex === undefined) return false

  if (intent.action === 'prependChild') {
    const firstChild = targetItem.items?.[0]
    return firstChild?.tocLineIndex === sourceTocLineIndex
  }

  const targetCtx = findSiblingContext(tree, targetItem.tocLineIndex)
  if (!targetCtx || targetCtx.list !== sourceCtx.list) return false

  return sourceCtx.index === targetCtx.index + 1
}

function dropIntentToDropTarget(
  tree: SidebarTreeItem[],
  intent: DropIntent,
): DropTarget | null {
  if (intent.isRootPrepend) return null

  const item = findTreeItemByNodeId(tree, intent.targetNodeId!)
  if (!item || item.tocLineIndex === undefined) return null

  const noteIndex = extractNoteIndexFromLink(item.link)
  const base: DropTarget = {
    targetTocLineIndex: item.tocLineIndex,
    targetNoteIndex: noteIndex ?? undefined,
    targetFolderPath:
      !noteIndex && item.folderPath?.length ? item.folderPath : undefined,
    placement: intent.action === 'prependChild' ? 'inside' : 'after',
    projectedDepth: 0,
  }
  return base
}

function createDropPlaceholder(sourceTocLineIndex: number): SidebarTreeItem {
  return {
    text: '',
    isDragPlaceholder: true,
    tocLineIndex: -(sourceTocLineIndex + 1),
  }
}

function markDragSourceSlot(
  items: SidebarTreeItem[],
  tocLineIndex: number,
): SidebarTreeItem[] {
  return items.map((item) => {
    const next: SidebarTreeItem = { ...item }
    if (item.tocLineIndex === tocLineIndex) {
      next.isDragSourceSlot = true
      return next
    }
    if (item.items?.length) {
      next.items = markDragSourceSlot(item.items, tocLineIndex)
    }
    return next
  })
}

/**
 * 拖拽预览树：
 * - 无落点：源项原位 invisible 占位（总高度不变）
 * - 有落点：移除源项、在目标处插入占位，兄弟项随拖动方向让位
 */
export function buildSidebarDragPreviewTree(
  base: SidebarTreeItem[],
  dragSource: DragSource,
  intent: DropIntent | null,
): SidebarTreeItem[] {
  const cloned = cloneSidebarTree(base)

  if (!intent || isDropIntentNoOp(cloned, dragSource.tocLineIndex, intent)) {
    return markDragSourceSlot(cloned, dragSource.tocLineIndex)
  }

  const target = dropIntentToDropTarget(cloned, intent)
  if (!target && !intent.isRootPrepend) {
    return markDragSourceSlot(cloned, dragSource.tocLineIndex)
  }

  const { tree: withoutSource } = removeFromListByTocLineIndex(
    cloned,
    dragSource.tocLineIndex,
  )
  const placeholder = createDropPlaceholder(dragSource.tocLineIndex)

  if (intent.isRootPrepend) {
    return [placeholder, ...withoutSource]
  }

  const inserted = insertRelativeToTarget(withoutSource, target!, placeholder, {
    expandInside: false,
  })
  if (!inserted) {
    return markDragSourceSlot(cloned, dragSource.tocLineIndex)
  }

  return inserted
}

export function applyMoveInSidebarTreeByTocLine(
  items: SidebarTreeItem[],
  dragSource: DragSource,
  target: DropTarget,
): SidebarTreeItem[] {
  const { tree: withoutDrag, removed } = removeFromListByTocLineIndex(
    items,
    dragSource.tocLineIndex,
  )
  if (!removed) return items

  const inserted = insertRelativeToTarget(withoutDrag, target, removed)
  return inserted ?? items
}

export function applyMoveInSidebarTree(
  items: SidebarTreeItem[],
  dragNoteIndex: string,
  target: DropTarget,
): SidebarTreeItem[] {
  const { tree: withoutDrag, removed } = removeFromList(items, dragNoteIndex)
  if (!removed) return items

  const inserted = target.targetNoteIndex
    ? insertIntoList(
        withoutDrag,
        target.targetNoteIndex,
        target.placement,
        removed,
      )
    : null

  return inserted ?? items
}

