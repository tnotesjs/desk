import type {
  DeskResult,
  DeskTocNode,
  KnowledgeBaseDetail,
  NoteCreateRequest,
  NoteDocumentDto,
  TocEntryRefDto,
  WorkspaceOverview
} from '../../../../shared/contracts'

export interface DocumentSession {
  document: NoteDocumentDto
  content: string
  dirty: boolean
  /** At least one unsaved edit came from the source-preserving visual editor. */
  preserveSourceOnSave: boolean
  externalConflict: boolean
  saving: boolean
}

export interface GitAttention {
  knowledgeBaseId: string
  knowledgeBaseName: string
  kind: 'behind' | 'conflict'
  message: string
}

export function resultValue<T>(result: DeskResult<T>): T {
  if (result.ok) return result.value
  const error = new Error(result.error.message) as Error & { code?: string }
  error.code = result.error.code
  throw error
}

export function ipcPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function documentKey(knowledgeBaseId: string, noteUuid: string): string {
  return `${knowledgeBaseId}:${noteUuid}`
}

export function tocEntry(node: DeskTocNode): TocEntryRefDto {
  return node.type === 'note'
    ? { type: 'note', noteUuid: node.uuid }
    : { type: 'folder', folderPath: [...node.folderPath] }
}

export function notePlacement(
  placement: NoteCreateRequest['placement']
): NoteCreateRequest['placement'] {
  if (!placement || placement.type === 'root') {
    return { type: 'root', placement: placement?.placement ?? 'end' }
  }
  if (placement.type === 'note') {
    return {
      type: 'note',
      targetNoteUuid: placement.targetNoteUuid,
      placement: placement.placement
    }
  }
  return {
    type: 'folder',
    folderPath: [...placement.folderPath],
    placement: placement.placement
  }
}

export function replaceDescriptor(
  overview: WorkspaceOverview,
  detail: KnowledgeBaseDetail
): WorkspaceOverview {
  const update = (
    items: WorkspaceOverview['knowledgeBases']
  ): WorkspaceOverview['knowledgeBases'] =>
    items.map((item) => (item.id === detail.id ? detail : item))
  return {
    ...overview,
    knowledgeBases: update(overview.knowledgeBases),
    allKnowledgeBases: update(overview.allKnowledgeBases)
  }
}
