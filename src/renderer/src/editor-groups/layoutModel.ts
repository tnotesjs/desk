import type {
  EditorGroupNode,
  EditorLayoutNode,
  EditorSplitNode,
  EditorTab
} from '../../../shared/contracts'

export type SplitPlacement = 'left' | 'right' | 'top' | 'bottom'

export function createId(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`
}

export function createGroup(tabs: EditorTab[] = []): EditorGroupNode {
  return {
    type: 'group',
    id: createId('group'),
    tabs,
    activeTabId: tabs[0]?.id ?? null
  }
}

export function visitGroups(
  node: EditorLayoutNode,
  visitor: (group: EditorGroupNode) => void
): void {
  if (node.type === 'group') {
    visitor(node)
    return
  }
  visitGroups(node.first, visitor)
  visitGroups(node.second, visitor)
}

export function listGroups(node: EditorLayoutNode): EditorGroupNode[] {
  const groups: EditorGroupNode[] = []
  visitGroups(node, (group) => groups.push(group))
  return groups
}

export function findGroup(node: EditorLayoutNode, groupId: string): EditorGroupNode | null {
  if (node.type === 'group') return node.id === groupId ? node : null
  return findGroup(node.first, groupId) ?? findGroup(node.second, groupId)
}

export function findTab(
  node: EditorLayoutNode,
  tabId: string
): { group: EditorGroupNode; tab: EditorTab } | null {
  for (const group of listGroups(node)) {
    const tab = group.tabs.find((item) => item.id === tabId)
    if (tab) return { group, tab }
  }
  return null
}

export function updateGroup(
  node: EditorLayoutNode,
  groupId: string,
  updater: (group: EditorGroupNode) => EditorGroupNode
): EditorLayoutNode {
  if (node.type === 'group') return node.id === groupId ? updater(node) : node
  return {
    ...node,
    first: updateGroup(node.first, groupId, updater),
    second: updateGroup(node.second, groupId, updater)
  }
}

export function insertTab(
  node: EditorLayoutNode,
  groupId: string,
  tab: EditorTab,
  index?: number
): EditorLayoutNode {
  return updateGroup(node, groupId, (group) => {
    const nextTabs = [...group.tabs]
    const insertionIndex = Math.max(0, Math.min(index ?? nextTabs.length, nextTabs.length))
    nextTabs.splice(insertionIndex, 0, tab)
    return { ...group, tabs: nextTabs, activeTabId: tab.id }
  })
}

export function removeTab(
  node: EditorLayoutNode,
  groupId: string,
  tabId: string
): EditorLayoutNode {
  return updateGroup(node, groupId, (group) => {
    const tabIndex = group.tabs.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) return group
    const tabs = group.tabs.filter((tab) => tab.id !== tabId)
    const activeTabId =
      group.activeTabId === tabId
        ? (tabs[Math.min(tabIndex, tabs.length - 1)]?.id ?? null)
        : group.activeTabId
    return { ...group, tabs, activeTabId }
  })
}

export function activateTab(
  node: EditorLayoutNode,
  groupId: string,
  tabId: string
): EditorLayoutNode {
  return updateGroup(node, groupId, (group) =>
    group.tabs.some((tab) => tab.id === tabId) ? { ...group, activeTabId: tabId } : group
  )
}

export function splitGroupWithTab(
  node: EditorLayoutNode,
  groupId: string,
  placement: SplitPlacement,
  tab: EditorTab
): { layout: EditorLayoutNode; groupId: string } {
  const newGroup = createGroup([tab])
  const replace = (current: EditorLayoutNode): EditorLayoutNode => {
    if (current.type === 'group') {
      if (current.id !== groupId) return current
      const direction = placement === 'left' || placement === 'right' ? 'horizontal' : 'vertical'
      const newFirst = placement === 'left' || placement === 'top'
      const split: EditorSplitNode = {
        type: 'split',
        id: createId('split'),
        direction,
        ratio: 0.5,
        first: newFirst ? newGroup : current,
        second: newFirst ? current : newGroup
      }
      return split
    }
    return { ...current, first: replace(current.first), second: replace(current.second) }
  }
  return { layout: replace(node), groupId: newGroup.id }
}

export function setSplitRatio(
  node: EditorLayoutNode,
  splitId: string,
  ratio: number
): EditorLayoutNode {
  if (node.type === 'group') return node
  if (node.id === splitId) return { ...node, ratio: Math.max(0.15, Math.min(0.85, ratio)) }
  return {
    ...node,
    first: setSplitRatio(node.first, splitId, ratio),
    second: setSplitRatio(node.second, splitId, ratio)
  }
}

export function collapseEmptyGroups(node: EditorLayoutNode): EditorLayoutNode {
  if (node.type === 'group') return node
  const first = collapseEmptyGroups(node.first)
  const second = collapseEmptyGroups(node.second)
  if (first.type === 'group' && first.tabs.length === 0) return second
  if (second.type === 'group' && second.tabs.length === 0) return first
  return { ...node, first, second }
}
