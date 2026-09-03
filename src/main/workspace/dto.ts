import { createHash } from 'node:crypto'

import type { KnowledgeBaseSnapshot, NoteDocument, TocEntryRef } from '@tnotesjs/core/workspace'
import type {
  DeskTocNode,
  KnowledgeBaseDescriptor,
  KnowledgeBaseDetail,
  NoteDocumentDto,
  TocEntryRefDto
} from '../../shared/contracts'

import type { CoreTocNode, KnowledgeBaseHandle } from './types'

export function stablePathSuffix(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 10)
}

export function iconFromSnapshot(snapshot: KnowledgeBaseSnapshot): KnowledgeBaseDescriptor['icon'] {
  const rootItem = snapshot.config?.root_item
  const icon = rootItem?.icon
  if (!icon || typeof icon !== 'object') return null
  return {
    src: typeof icon.src === 'string' ? icon.src : undefined,
    svg: typeof icon.svg === 'string' ? icon.svg : undefined
  }
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function externalLinksFromSnapshot(
  snapshot: KnowledgeBaseSnapshot
): Pick<KnowledgeBaseDescriptor, 'repositoryUrl' | 'pageUrl'> {
  const author = snapshot.config?.author?.trim()
  const repoName = snapshot.config?.repoName?.trim()
  return {
    repositoryUrl:
      author && repoName
        ? `https://github.com/${encodeURIComponent(author)}/${encodeURIComponent(repoName)}`
        : undefined,
    pageUrl: httpUrl(snapshot.config?.root_item?.link)
  }
}

export function descriptor(handle: KnowledgeBaseHandle): KnowledgeBaseDescriptor {
  const snapshot = handle.snapshot
  return {
    id: handle.id,
    configId: snapshot.id,
    name: handle.name,
    rootPath: handle.rootPath,
    displayName: snapshot.config?.root_item?.title || handle.name.replace(/^TNotes\./, ''),
    icon: iconFromSnapshot(snapshot),
    ...externalLinksFromSnapshot(snapshot),
    health: snapshot.health.status,
    diagnostics: snapshot.health.diagnostics,
    noteCount: snapshot.notes.length,
    snapshotRevision: snapshot.revision
  }
}

export function mapToc(
  nodes: CoreTocNode[],
  snapshot: KnowledgeBaseSnapshot,
  folderPath: string[] = []
): DeskTocNode[] {
  const noteByIndex = new Map(snapshot.notes.map((note) => [note.index, note]))
  return nodes.flatMap((node): DeskTocNode[] => {
    if (node.kind === 'folder') {
      const title = node.title ?? '未命名分组'
      const currentPath = [...folderPath, title]
      return [
        {
          type: 'group',
          title,
          tocLineIndex: node.tocLineIndex,
          nodeId: `folder:${node.tocLineIndex}:${currentPath.join('/')}`,
          folderPath: currentPath,
          children: mapToc(node.children, snapshot, currentPath)
        }
      ]
    }
    if (!node.noteIndex) return []
    const note = noteByIndex.get(node.noteIndex)
    if (!note) return []
    return [
      {
        type: 'note',
        uuid: note.uuid,
        title: note.title,
        dirName: note.dirName,
        noteIndex: note.index,
        tocLineIndex: node.tocLineIndex,
        nodeId: `note:${note.uuid}`,
        completed: Boolean(note.config.done),
        children: mapToc(node.children, snapshot, folderPath)
      }
    ]
  })
}

export function toDetail(handle: KnowledgeBaseHandle): KnowledgeBaseDetail {
  return {
    ...descriptor(handle),
    toc: mapToc(handle.snapshot.toc as CoreTocNode[], handle.snapshot)
  }
}

export function toNoteDocument(
  handle: KnowledgeBaseHandle,
  document: NoteDocument
): NoteDocumentDto {
  return {
    knowledgeBaseId: handle.id,
    uuid: document.uuid,
    index: document.index,
    title: document.title,
    dirName: document.dirName,
    directoryPath: document.directoryPath,
    readmePath: document.readmePath,
    configPath: document.configPath,
    content: document.content,
    revision: document.revision,
    config: document.config,
    readOnly: handle.snapshot.health.status !== 'ready'
  }
}

export function coreEntryRef(entry: TocEntryRefDto): TocEntryRef {
  return entry
}
