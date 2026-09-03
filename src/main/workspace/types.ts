import type { KnowledgeBaseSnapshot, TNotesWorkspace } from '@tnotesjs/core/workspace'
import type {
  ExternalNoteChangeEvent,
  ExternalNoteFileChangeEvent,
  WorkspaceOverview
} from '../../shared/contracts'

export const KNOWLEDGE_BASE_NAME = /^TNotes\./

export interface CoreTocNode {
  kind: 'folder' | 'note'
  title?: string
  noteIndex?: string
  tocLineIndex: number
  children: CoreTocNode[]
}

export interface KnowledgeBaseHandle {
  id: string
  name: string
  rootPath: string
  workspace: TNotesWorkspace
  snapshot: KnowledgeBaseSnapshot
}

export interface WorkspaceManagerEvents {
  changed: [WorkspaceOverview]
  noteExternalChanged: [ExternalNoteChangeEvent]
  noteFileExternalChanged: [ExternalNoteFileChangeEvent]
}

export interface GitRepositoryDescriptor {
  knowledgeBaseId: string
  knowledgeBaseName: string
  configId: string
  rootPath: string
  notes: Array<{
    uuid: string
    index: string
    title: string
    dirName: string
    directoryPath: string
  }>
}
