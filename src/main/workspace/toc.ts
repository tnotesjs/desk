import type { NotePlacement } from '@tnotesjs/core/workspace'
import type {
  DeletePreviewDto,
  KnowledgeBaseDetail,
  TocCreateGroupRequest,
  TocDeleteRequest,
  TocEntryRefDto,
  TocMoveRequest,
  TocRenameGroupRequest
} from '../../shared/contracts'

import { coreEntryRef } from './dto'
import { applySnapshotMutation, type MutationSideEffects } from './mutations'
import type { KnowledgeBaseHandle } from './types'

export async function moveToc(
  handle: KnowledgeBaseHandle,
  request: TocMoveRequest,
  effects: MutationSideEffects
): Promise<KnowledgeBaseDetail> {
  const result = await handle.workspace.toc.move({
    source: coreEntryRef(request.source),
    target: coreEntryRef(request.target),
    placement: request.placement,
    expectedSnapshotRevision: request.expectedSnapshotRevision
  })
  return applySnapshotMutation(handle, result, effects)
}

export async function createTocGroup(
  handle: KnowledgeBaseHandle,
  request: TocCreateGroupRequest,
  effects: MutationSideEffects
): Promise<KnowledgeBaseDetail> {
  const result = await handle.workspace.toc.createGroup({
    title: request.title,
    placement: request.placement as NotePlacement | undefined,
    expectedSnapshotRevision: request.expectedSnapshotRevision
  })
  return applySnapshotMutation(handle, result, effects)
}

export async function renameTocGroup(
  handle: KnowledgeBaseHandle,
  request: TocRenameGroupRequest,
  effects: MutationSideEffects
): Promise<KnowledgeBaseDetail> {
  const result = await handle.workspace.toc.renameGroup({
    folderPath: request.folderPath,
    title: request.title,
    expectedSnapshotRevision: request.expectedSnapshotRevision
  })
  return applySnapshotMutation(handle, result, effects)
}

export async function previewDelete(
  handle: KnowledgeBaseHandle,
  knowledgeBaseId: string,
  entry: TocEntryRefDto
): Promise<DeletePreviewDto> {
  const preview = await handle.workspace.toc.previewDelete(coreEntryRef(entry))
  return { knowledgeBaseId, ...preview, entry, untrackedFilePaths: [] }
}

export async function deleteToc(
  handle: KnowledgeBaseHandle,
  request: TocDeleteRequest,
  effects: MutationSideEffects
): Promise<KnowledgeBaseDetail> {
  const result = await handle.workspace.toc.deleteEntry({
    entry: coreEntryRef(request.entry),
    expectedSnapshotRevision: request.expectedSnapshotRevision
  })
  return applySnapshotMutation(handle, result, effects)
}
