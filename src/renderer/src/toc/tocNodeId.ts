/**
 * Desk TOC node ids (adapted from @tnotesjs/core tocNodeId).
 */

export type TocMoveAction = 'moveAfter' | 'prependChild'

export interface SidebarNodeLike {
  text: string
  link?: string
  folderPath?: string[]
  tocLineIndex?: number
  nodeId?: string
  items?: SidebarNodeLike[]
}

function extractNoteIndexFromLink(link?: string): string | null {
  if (!link) return null
  const match = link.match(/\/notes\/(\d{4})\./)
  return match ? match[1] : null
}

export function nodeIdForNote(noteIndex: string): string {
  return `note:${noteIndex}`
}

export function nodeIdForFolder(folderPath: string[]): string {
  return `folder:${folderPath.join('/')}`
}

export function nodeIdForLine(tocLineIndex: number): string {
  return `line:${tocLineIndex}`
}

export function computeSidebarNodeId(item: SidebarNodeLike): string {
  if (item.nodeId) return item.nodeId

  const noteIndex = extractNoteIndexFromLink(item.link)
  if (noteIndex) return nodeIdForNote(noteIndex)

  if (item.tocLineIndex !== undefined && !item.link) {
    return nodeIdForLine(item.tocLineIndex)
  }

  if (item.folderPath?.length) {
    return nodeIdForFolder(item.folderPath)
  }

  if (item.tocLineIndex !== undefined) {
    return nodeIdForLine(item.tocLineIndex)
  }

  return `text:${item.text}`
}

export function enrichSidebarNodeIds<T extends SidebarNodeLike>(items: T[]): T[] {
  return items.map((item) => {
    const nodeId = computeSidebarNodeId(item)
    const next = { ...item, nodeId } as T
    if (item.items?.length) {
      next.items = enrichSidebarNodeIds(item.items) as T['items']
    }
    return next
  })
}

export function parseNodeId(nodeId: string): {
  kind: 'note' | 'folder' | 'line' | 'text'
  noteIndex?: string
  folderPath?: string[]
  tocLineIndex?: number
} {
  if (nodeId.startsWith('note:')) {
    return { kind: 'note', noteIndex: nodeId.slice(5) }
  }
  if (nodeId.startsWith('folder:')) {
    const path = nodeId.slice(7)
    return {
      kind: 'folder',
      folderPath: path ? path.split('/') : []
    }
  }
  if (nodeId.startsWith('line:')) {
    return { kind: 'line', tocLineIndex: Number(nodeId.slice(5)) }
  }
  return { kind: 'text' }
}
