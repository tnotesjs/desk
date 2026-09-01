import type {
  ChangedFile,
  KnowledgeBaseSnapshot,
  MutationResult,
  NoteDocument
} from '@tnotesjs/core/workspace'
import type { KnowledgeBaseDetail, NoteMutationDto } from '../../shared/contracts'

import { toDetail, toNoteDocument } from './dto'
import type { KnowledgeBaseHandle } from './types'

export type MutationSideEffects = {
  markInternalWrites: (changedFiles: ChangedFile[]) => void
  emitChanged: () => void
}

export async function applyNoteMutation(
  handle: KnowledgeBaseHandle,
  result: MutationResult<NoteDocument>,
  effects: MutationSideEffects
): Promise<NoteMutationDto> {
  effects.markInternalWrites(result.changedFiles)
  handle.snapshot = await handle.workspace.refresh()
  effects.emitChanged()
  return {
    note: toNoteDocument(handle, result.value),
    knowledgeBase: toDetail(handle),
    changedFiles: result.changedFiles
  }
}

export function applySnapshotMutation(
  handle: KnowledgeBaseHandle,
  result: MutationResult<KnowledgeBaseSnapshot>,
  effects: MutationSideEffects
): KnowledgeBaseDetail {
  effects.markInternalWrites(result.changedFiles)
  handle.snapshot = result.value
  effects.emitChanged()
  return toDetail(handle)
}
