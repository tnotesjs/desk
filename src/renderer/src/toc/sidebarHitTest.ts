/**
 * vitepress/components/Layout/sidebarHitTest.ts
 *
 * 语雀式落点命中：Y 轴行带 + 迟滞，输出 moveAfter / prependChild（含拖到列表顶）。
 */

import {
  flattenVisibleSidebar,
  getDropProjection,
  getDepthContentLeft,
  getSubtreeDepthSpan,
  findTreeItem,
  isDragExternalToTargetParent,
  shouldPrependInsideExternalNoteRow,
  SIDEBAR_ARROW_WIDTH,
  SIDEBAR_INDENT_SIZE,
  SIDEBAR_ROW_BASE_PADDING,
  type DragSource,
  type DropIndicatorMeta,
  type DropProjectionResult,
  type FlatSidebarRow,
  type SidebarTreeItem,
} from './sidebarDragLogic'
import { computeSidebarNodeId } from './tocNodeId'

import type { TocMoveAction } from './tocNodeId'


export type DropIndicatorMode = DropIndicatorMeta['mode']

export interface DropIntent {
  action: TocMoveAction
  /** 文件夹 prependChild 时有值；拖到列表顶（prepend 到根容器）时省略 */
  targetNodeId: string | null
  sourceNodeId: string
  indicator: DropIndicatorMeta
  /** 用于 overlay：蓝线相对 targetNodeId 行；moveAfter 恒为 after（目标行下方） */
  linePlacement: 'before' | 'after'
  hoverRowIndex: number
  /** 语雀式：拖到侧栏列表顶，无 target_uuid、无 overlay，仅预览树让位 */
  isRootPrepend?: boolean
}

export interface RowMetric {
  nodeId: string
  tocLineIndex: number | null
  rect: DOMRect
}

export interface HitTestState {
  lastVerticalPlacement: 'before' | 'after' | null
  stickyPreferInside: boolean | null
  /** 父级下首位 prepend 迟滞：避免与 moveAfter 闪烁 */
  stickyPrependParentNodeId: string | null
  lastIntentFingerprint: string | null
}

export interface HitTestInput {
  tree: SidebarTreeItem[]
  flat: FlatSidebarRow[]
  dragSource: DragSource
  sourceNodeId: string
  clientX: number
  clientY: number
  navLeft: number
  navTop: number
  navWidth: number
  rowMetrics: RowMetric[]
  maxDepth: number
}

const VERTICAL_HYSTERESIS_RATIO = 0.35
/** 同级第一项：扩大上半区，便于 prependChild(父) */
const FIRST_SIBLING_BEFORE_RATIO = 0.72
const PREPEND_FIRST_CHILD_ZONE_EXIT_PX = 6
const INSIDE_ENTER_RATIO = 0.55
const INSIDE_EXIT_RATIO = 0.3
const ROW_HIT_PADDING_PX = 8

export function createHitTestState(): HitTestState {
  return {
    lastVerticalPlacement: null,
    stickyPreferInside: null,
    stickyPrependParentNodeId: null,
    lastIntentFingerprint: null,
  }
}

export function dropIntentFingerprint(intent: DropIntent): string {
  return `${intent.action}|${intent.targetNodeId ?? ''}|${intent.isRootPrepend ? 1 : 0}|${intent.indicator.mode}|${intent.indicator.activeDepth}|${intent.linePlacement}`
}

function findFirstRootRow(
  flat: FlatSidebarRow[],
  rowMetrics: RowMetric[],
): { flatIndex: number; row: FlatSidebarRow; metric: RowMetric } | null {
  const rootRows = flat.filter((row) => row.depth === 0)
  if (!rootRows.length) return null

  const rootTocIndices = new Set(
    rootRows
      .map((row) => row.tocLineIndex)
      .filter((index): index is number => index !== null),
  )
  const rootMetrics = rowMetrics
    .filter(
      (m) => m.tocLineIndex !== null && rootTocIndices.has(m.tocLineIndex),
    )
    .sort((a, b) => a.rect.top - b.rect.top)

  const metric = rootMetrics[0]
  if (!metric || metric.tocLineIndex === null) return null

  const flatIndex = flat.findIndex(
    (row) => row.tocLineIndex === metric.tocLineIndex,
  )
  if (flatIndex < 0) return null

  return { flatIndex, row: flat[flatIndex], metric }
}

/** 语雀：nav 顶栏与首行之间的空隙 → prepend 到列表顶 */
function isNavTopGap(
  clientY: number,
  navTop: number,
  firstRowRect: DOMRect,
): boolean {
  return clientY >= navTop && clientY < firstRowRect.top + 4
}

/** 首行上半区 → prepend 到列表顶（与 nav 顶空隙语义一致） */
function isFirstRootUpperPrependZone(
  clientY: number,
  firstRowRect: DOMRect,
): boolean {
  const mid = firstRowRect.top + firstRowRect.height / 2
  return clientY >= firstRowRect.top && clientY < mid
}

function isFirstSiblingRow(flat: FlatSidebarRow[], index: number): boolean {
  return flat[index].depth > 0 && findPrevSiblingIndex(flat, index) < 0
}

function findFirstChildRowIndex(
  flat: FlatSidebarRow[],
  parentIndex: number,
): number {
  const parentDepth = flat[parentIndex].depth
  for (let i = parentIndex + 1; i < flat.length; i++) {
    if (flat[i].depth <= parentDepth) break
    if (flat[i].depth === parentDepth + 1) return i
  }
  return -1
}

function getMetricForRow(
  rowMetrics: RowMetric[],
  tocLineIndex: number | null,
): RowMetric | undefined {
  if (tocLineIndex === null) return undefined
  return rowMetrics.find((m) => m.tocLineIndex === tocLineIndex)
}

function isClientYInPrependFirstChildZone(
  clientY: number,
  parentMetric: RowMetric,
  firstChildMetric: RowMetric,
  sticky: boolean,
): boolean {
  const zoneTop = parentMetric.rect.top + parentMetric.rect.height * 0.3
  const zoneBottom = sticky
    ? firstChildMetric.rect.bottom + PREPEND_FIRST_CHILD_ZONE_EXIT_PX
    : firstChildMetric.rect.top +
      firstChildMetric.rect.height * FIRST_SIBLING_BEFORE_RATIO
  return clientY >= zoneTop && clientY <= zoneBottom
}

function tryResolvePrependFirstChildZone(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  rowMetrics: RowMetric[],
  dragSource: DragSource,
  sourceNodeId: string,
  clientY: number,
  state: HitTestState,
): DropIntent | null {
  if (state.stickyPrependParentNodeId) {
    const parentIndex = flat.findIndex(
      (row) => nodeIdForFlatRow(row, tree) === state.stickyPrependParentNodeId,
    )
    if (parentIndex >= 0) {
      const firstChildIndex = findFirstChildRowIndex(flat, parentIndex)
      if (firstChildIndex >= 0) {
        const parentMetric = getMetricForRow(
          rowMetrics,
          flat[parentIndex].tocLineIndex,
        )
        const childMetric = getMetricForRow(
          rowMetrics,
          flat[firstChildIndex].tocLineIndex,
        )
        if (
          parentMetric &&
          childMetric &&
          isClientYInPrependFirstChildZone(
            clientY,
            parentMetric,
            childMetric,
            true,
          ) &&
          flat[firstChildIndex].tocLineIndex !== dragSource.tocLineIndex
        ) {
          return buildPrependFirstChildIntent(
            tree,
            flat,
            parentIndex,
            sourceNodeId,
            firstChildIndex,
          )
        }
      }
    }
    state.stickyPrependParentNodeId = null
  }

  for (let parentIndex = 0; parentIndex < flat.length; parentIndex++) {
    const parentRow = flat[parentIndex]
    if (parentRow.kind !== 'folder' || !parentRow.collapsed) {
      continue
    }
    if (parentRow.tocLineIndex === dragSource.tocLineIndex) continue

    const dragRow = flat.find(
      (row) => row.tocLineIndex === dragSource.tocLineIndex,
    )
    if (!dragRow || !isDragExternalToTargetParent(flat, dragRow, parentRow)) {
      continue
    }

    const parentMetric = getMetricForRow(rowMetrics, parentRow.tocLineIndex)
    if (!parentMetric) continue

    const zoneTop = parentRow.hasChildren
      ? parentMetric.rect.top + parentMetric.rect.height * 0.3
      : parentMetric.rect.top + parentMetric.rect.height * 0.5
    if (clientY < zoneTop || clientY > parentMetric.rect.bottom) continue

    const intent = buildPrependFirstChildIntent(
      tree,
      flat,
      parentIndex,
      sourceNodeId,
      parentIndex,
    )
    if (!intent) continue

    state.stickyPrependParentNodeId = intent.targetNodeId
    state.lastVerticalPlacement = 'before'
    state.stickyPreferInside = null
    return intent
  }

  for (let i = 0; i < flat.length; i++) {
    if (!isFirstSiblingRow(flat, i)) continue

    const parentIndex = findParentRowIndex(flat, i)
    if (parentIndex < 0) continue

    const parentMetric = getMetricForRow(rowMetrics, flat[parentIndex].tocLineIndex)
    const childMetric = getMetricForRow(rowMetrics, flat[i].tocLineIndex)
    if (!parentMetric || !childMetric) continue
    if (flat[i].tocLineIndex === dragSource.tocLineIndex) continue

    if (
      !isClientYInPrependFirstChildZone(
        clientY,
        parentMetric,
        childMetric,
        false,
      )
    ) {
      continue
    }

    const intent = buildPrependFirstChildIntent(
      tree,
      flat,
      parentIndex,
      sourceNodeId,
      i,
    )
    if (!intent) continue

    state.stickyPrependParentNodeId = intent.targetNodeId
    state.lastVerticalPlacement = 'before'
    state.stickyPreferInside = null
    return intent
  }

  return null
}

function verticalPlacementForRowHit(
  rect: DOMRect,
  clientY: number,
): 'before' | 'after' {
  const mid = rect.top + rect.height / 2
  return clientY < mid ? 'before' : 'after'
}

function tryResolveIntoExternalNoteZone(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  rowMetrics: RowMetric[],
  dragSource: DragSource,
  sourceNodeId: string,
  clientY: number,
): DropIntent | null {
  const dragIndex = flat.findIndex(
    (row) => row.tocLineIndex === dragSource.tocLineIndex,
  )
  if (dragIndex < 0) return null

  for (let i = 0; i < flat.length; i++) {
    const overRow = flat[i]
    if (!overRow.noteIndex) continue
    if (overRow.tocLineIndex === dragSource.tocLineIndex) continue

    const metric = getMetricForRow(rowMetrics, overRow.tocLineIndex)
    if (!metric) continue

    const hitTop = metric.rect.top - ROW_HIT_PADDING_PX
    const hitBottom = metric.rect.bottom + ROW_HIT_PADDING_PX
    if (clientY < hitTop || clientY > hitBottom) continue

    const verticalPlacement = verticalPlacementForRowHit(metric.rect, clientY)
    const dragRow = flat[dragIndex]
    const nestIntoNextRowUpperHalf =
      i === dragIndex + 1 &&
      verticalPlacement === 'before' &&
      isDragExternalToTargetParent(flat, dragRow, overRow)
    if (
      !shouldPrependInsideExternalNoteRow(
        flat,
        dragSource,
        i,
        overRow,
        verticalPlacement,
      ) &&
      !nestIntoNextRowUpperHalf
    ) {
      continue
    }

    const intent = buildPrependFirstChildIntent(
      tree,
      flat,
      i,
      sourceNodeId,
      i,
    )
    if (!intent) continue

    return intent
  }

  return null
}

function buildRootPrependIntent(
  sourceNodeId: string,
  hoverRowIndex: number,
): DropIntent {
  return {
    action: 'prependChild',
    targetNodeId: null,
    sourceNodeId,
    isRootPrepend: true,
    indicator: { mode: 'root-prepend', depthLevels: [0], activeDepth: 0 },
    linePlacement: 'before',
    hoverRowIndex,
  }
}

function nodeIdForFlatRow(row: FlatSidebarRow, tree: SidebarTreeItem[]): string {
  if (row.nodeId) return row.nodeId
  if (row.tocLineIndex !== null) {
    const item = findTreeItemByTocLine(tree, row.tocLineIndex)
    if (item) return computeSidebarNodeId(item)
  }
  if (row.noteIndex) return `note:${row.noteIndex}`
  if (row.folderPath?.length) return `folder:${row.folderPath.join('/')}`
  return `line:${row.tocLineIndex ?? 0}`
}

function findPrevSiblingIndex(
  flat: FlatSidebarRow[],
  index: number,
): number {
  const depth = flat[index].depth
  for (let i = index - 1; i >= 0; i--) {
    if (flat[i].depth === depth) return i
    if (flat[i].depth < depth) break
  }
  return -1
}

function findParentRowIndex(flat: FlatSidebarRow[], index: number): number {
  const depth = flat[index].depth
  if (depth <= 0) return -1
  for (let i = index - 1; i >= 0; i--) {
    if (flat[i].depth < depth) return i
  }
  return -1
}

function buildPrependFirstChildIntent(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  parentIndex: number,
  sourceNodeId: string,
  hoverRowIndex: number,
): DropIntent | null {
  const parentRow = flat[parentIndex]
  const parentNodeId = nodeIdForFlatRow(parentRow, tree)
  if (!parentNodeId || parentNodeId === sourceNodeId) return null

  return {
    action: 'prependChild',
    targetNodeId: parentNodeId,
    sourceNodeId,
    indicator: {
      mode: 'inside',
      depthLevels: [parentRow.depth],
      activeDepth: parentRow.depth,
    },
    linePlacement: 'before',
    hoverRowIndex,
  }
}

function findTreeItemByTocLine(
  items: SidebarTreeItem[],
  tocLineIndex: number,
): SidebarTreeItem | null {
  for (const node of items) {
    if (node.tocLineIndex === tocLineIndex) return node
    if (node.items?.length) {
      const found = findTreeItemByTocLine(node.items, tocLineIndex)
      if (found) return found
    }
  }
  return null
}

function resolveVerticalPlacement(
  rect: DOMRect,
  clientY: number,
  state: HitTestState,
  isFirstSibling = false,
): 'before' | 'after' {
  const beforeRatio = isFirstSibling
    ? FIRST_SIBLING_BEFORE_RATIO
    : VERTICAL_HYSTERESIS_RATIO
  const mid = rect.top + rect.height / 2
  const topBound = rect.top + rect.height * beforeRatio
  const bottomBound = rect.top + rect.height * (1 - VERTICAL_HYSTERESIS_RATIO)

  if (state.lastVerticalPlacement === 'before' && clientY < bottomBound) {
    return 'before'
  }
  if (state.lastVerticalPlacement === 'after' && clientY > topBound) {
    return 'after'
  }

  const split = isFirstSibling
    ? rect.top + rect.height * beforeRatio
    : mid
  const next = clientY < split ? 'before' : 'after'
  state.lastVerticalPlacement = next
  return next
}

function findHoverRowIndex(
  flat: FlatSidebarRow[],
  dragSource: DragSource,
  clientY: number,
  rowMetrics: RowMetric[],
): number {
  const metricByNode = new Map(rowMetrics.map((m) => [m.tocLineIndex, m]))

  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY

  for (let i = 0; i < flat.length; i++) {
    const row = flat[i]
    if (row.tocLineIndex === dragSource.tocLineIndex) continue

    const metric =
      row.tocLineIndex !== null
        ? metricByNode.get(row.tocLineIndex)
        : rowMetrics.find(
            (m) =>
              m.nodeId === nodeIdForFlatRow(row, []) ||
              (row.noteIndex && m.nodeId === `note:${row.noteIndex}`),
          )

    const rect = metric?.rect
    if (!rect) continue

    const hitTop = rect.top - ROW_HIT_PADDING_PX
    const hitBottom = rect.bottom + ROW_HIT_PADDING_PX
    if (clientY < hitTop || clientY > hitBottom) continue

    const distance = Math.abs(clientY - (rect.top + rect.height / 2))
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i
    }
  }

  if (bestIndex >= 0) return bestIndex

  for (let i = 0; i < flat.length; i++) {
    const row = flat[i]
    if (row.tocLineIndex === dragSource.tocLineIndex) continue
    const metric =
      row.tocLineIndex !== null ? metricByNode.get(row.tocLineIndex) : null
    if (!metric) continue
    const centerY = metric.rect.top + metric.rect.height / 2
    const distance = Math.abs(clientY - centerY)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i
    }
  }

  return bestDistance <= 48 ? bestIndex : -1
}

function stabilizePointerOffset(
  offsetX: number,
  indentSize: number,
  overRow: FlatSidebarRow,
  verticalPlacement: 'before' | 'after',
  state: HitTestState,
): number {
  const canInside =
    overRow.hasChildren && verticalPlacement === 'after' && offsetX > 0
  if (!canInside) {
    state.stickyPreferInside = null
    return offsetX
  }

  const enterAt = indentSize * INSIDE_ENTER_RATIO
  const exitAt = indentSize * INSIDE_EXIT_RATIO

  if (state.stickyPreferInside === null) {
    state.stickyPreferInside = offsetX >= enterAt
  } else if (state.stickyPreferInside) {
    if (offsetX < exitAt) state.stickyPreferInside = false
  } else if (offsetX >= enterAt) {
    state.stickyPreferInside = true
  }

  return state.stickyPreferInside ? indentSize : Math.min(offsetX, 0)
}

function projectionToIntent(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  projection: DropProjectionResult,
  sourceNodeId: string,
  linePlacement: 'before' | 'after',
  hoverRowIndex: number,
): DropIntent | null {
  const { target, indicator } = projection

  if (target.placement === 'inside') {
    const targetNodeId = resolveTargetNodeId(tree, flat, target)
    if (!targetNodeId || targetNodeId === sourceNodeId) return null
    return {
      action: 'prependChild',
      targetNodeId,
      sourceNodeId,
      indicator,
      linePlacement,
      hoverRowIndex,
    }
  }

  if (target.placement === 'before') {
    const prevIndex = findPrevSiblingIndex(flat, hoverRowIndex)
    if (prevIndex < 0) {
      const overRow = flat[hoverRowIndex]
      if (overRow.depth === 0) {
        return buildRootPrependIntent(sourceNodeId, hoverRowIndex)
      }
      const parentIndex = findParentRowIndex(flat, hoverRowIndex)
      if (parentIndex < 0) return null
      return buildPrependFirstChildIntent(
        tree,
        flat,
        parentIndex,
        sourceNodeId,
        hoverRowIndex,
      )
    }
    const targetNodeId = nodeIdForFlatRow(flat[prevIndex], tree)
    return {
      action: 'moveAfter',
      targetNodeId,
      sourceNodeId,
      indicator,
      linePlacement: 'after',
      hoverRowIndex,
    }
  }

  const targetNodeId = resolveTargetNodeId(tree, flat, target)
  if (!targetNodeId || targetNodeId === sourceNodeId) return null

  return {
    action: 'moveAfter',
    targetNodeId,
    sourceNodeId,
    indicator,
    linePlacement: 'after',
    hoverRowIndex,
  }
}

function resolveTargetNodeId(
  tree: SidebarTreeItem[],
  flat: FlatSidebarRow[],
  target: DropProjectionResult['target'],
): string | null {
  if (target.targetTocLineIndex !== undefined) {
    const row = flat.find((r) => r.tocLineIndex === target.targetTocLineIndex)
    if (row) return nodeIdForFlatRow(row, tree)
    const item = findTreeItemByTocLine(tree, target.targetTocLineIndex)
    if (item) return computeSidebarNodeId(item)
  }
  if (target.targetNoteIndex) return `note:${target.targetNoteIndex}`
  if (target.targetFolderPath?.length) {
    return `folder:${target.targetFolderPath.join('/')}`
  }
  return null
}

export function collectRowMetrics(nav: HTMLElement): RowMetric[] {
  const metrics: RowMetric[] = []
  const rows = nav.querySelectorAll<HTMLElement>('.sidebar-row[data-toc-line-index]')
  rows.forEach((row) => {
    const raw = row.dataset.tocLineIndex
    if (raw === undefined || raw === '') return
    const tocLineIndex = Number(raw)
    const nodeId =
      row.dataset.nodeId ??
      (row.dataset.noteId
        ? `note:${row.dataset.noteId}`
        : `line:${tocLineIndex}`)
    metrics.push({
      nodeId,
      tocLineIndex,
      rect: row.getBoundingClientRect(),
    })
  })
  return metrics
}

export function resolveDropIntent(
  input: HitTestInput,
  state: HitTestState,
): DropIntent | null {
  const {
    tree,
    flat,
    dragSource,
    sourceNodeId,
    clientX,
    clientY,
    navLeft,
    dragSource: source,
  } = input

  const firstRoot = findFirstRootRow(flat, input.rowMetrics)
  if (
    firstRoot &&
    dragSource.tocLineIndex !== firstRoot.row.tocLineIndex &&
    (isNavTopGap(clientY, input.navTop, firstRoot.metric.rect) ||
      isFirstRootUpperPrependZone(clientY, firstRoot.metric.rect))
  ) {
    state.stickyPrependParentNodeId = null
    return buildRootPrependIntent(sourceNodeId, firstRoot.flatIndex)
  }

  const prependFirstChild = tryResolvePrependFirstChildZone(
    tree,
    flat,
    input.rowMetrics,
    dragSource,
    sourceNodeId,
    clientY,
    state,
  )
  if (prependFirstChild) {
    return prependFirstChild
  }

  const intoExternalNote = tryResolveIntoExternalNoteZone(
    tree,
    flat,
    input.rowMetrics,
    dragSource,
    sourceNodeId,
    clientY,
  )
  if (intoExternalNote) {
    return intoExternalNote
  }

  const hoverRowIndex = findHoverRowIndex(
    flat,
    dragSource,
    clientY,
    input.rowMetrics,
  )
  if (hoverRowIndex < 0) return null

  const overRow = flat[hoverRowIndex]
  const metric = input.rowMetrics.find(
    (m) => m.tocLineIndex === overRow.tocLineIndex,
  )
  const rect = metric?.rect
  if (!rect) return null

  const verticalPlacement = resolveVerticalPlacement(
    rect,
    clientY,
    state,
    isFirstSiblingRow(flat, hoverRowIndex),
  )
  const indentSize = SIDEBAR_INDENT_SIZE
  const baseIndentLeft =
    navLeft +
    SIDEBAR_ROW_BASE_PADDING +
    overRow.depth * indentSize +
    SIDEBAR_ARROW_WIDTH
  const rawOffsetX = clientX - baseIndentLeft
  const offsetX = stabilizePointerOffset(
    rawOffsetX,
    indentSize,
    overRow,
    verticalPlacement,
    state,
  )

  const dragged =
    source.noteIndex !== undefined
      ? findTreeItem(tree, source.noteIndex)
      : findTreeItemByTocLine(tree, source.tocLineIndex)
  const maxDepth =
    input.maxDepth > 0 ? input.maxDepth : Number.POSITIVE_INFINITY

  const projection = getDropProjection(
    tree,
    flat,
    dragSource,
    hoverRowIndex,
    verticalPlacement,
    {
      maxDepth,
      indentSize,
      draggedSubtreeDepthSpan: dragged ? getSubtreeDepthSpan(dragged) : 0,
    },
    { offsetX, clientX, navLeft },
  )

  if (!projection) return null

  return projectionToIntent(
    tree,
    flat,
    projection,
    sourceNodeId,
    verticalPlacement,
    hoverRowIndex,
  )
}

export function buildFlatForHitTest(
  tree: SidebarTreeItem[],
  dragTocLineIndex: number,
): FlatSidebarRow[] {
  return flattenVisibleSidebar(tree, 0, null, null, {
    forceCollapsedTocLineIndex: dragTocLineIndex,
  })
}

export { getDepthContentLeft }
