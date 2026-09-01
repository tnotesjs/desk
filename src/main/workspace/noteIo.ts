import fs from 'node:fs/promises'
import path from 'node:path'

import { resolvePathInsideDirectory } from '../noteAssetPath'
import { loadSettings, settingsForKnowledgeBase } from '../settings'

import type { ChangedFile, NotePlacement } from '@tnotesjs/core/workspace'
import type {
  AttachmentReadTextRequest,
  AttachmentWriteLocalRequest,
  AttachmentWriteLocalResult,
  AttachmentWriteTextRequest,
  NoteCreateRequest,
  NoteDocumentDto,
  NoteMutationDto,
  NoteRenameRequest,
  NoteSaveRequest,
  NoteUpdateConfigRequest
} from '../../shared/contracts'

import { toNoteDocument } from './dto'
import { applyNoteMutation, type MutationSideEffects } from './mutations'
import type { KnowledgeBaseHandle } from './types'

export type { MutationSideEffects as NoteMutationSideEffects }

export async function resolvePathInsideNote(
  handle: KnowledgeBaseHandle,
  noteUuid: string,
  requestedPath: string
): Promise<string> {
  const note = await handle.workspace.notes.read(noteUuid)
  return resolvePathInsideDirectory(note.directoryPath, requestedPath)
}

export async function readNote(
  handle: KnowledgeBaseHandle,
  noteUuid: string
): Promise<NoteDocumentDto> {
  return toNoteDocument(handle, await handle.workspace.notes.read(noteUuid))
}

export function resolveNotesTable(
  handle: KnowledgeBaseHandle,
  ids: string[]
): {
  notes: Array<{
    id: string
    title: string
    description: string
    noteUuid: string | null
  }>
  missingIds: string[]
} {
  const byIndex = new Map(handle.snapshot.notes.map((note) => [note.index, note]))
  const missingIds: string[] = []
  const notes: Array<{
    id: string
    title: string
    description: string
    noteUuid: string | null
  }> = []

  for (const id of ids) {
    const note = byIndex.get(id)
    if (!note) {
      missingIds.push(id)
      continue
    }
    const description = typeof note.config.description === 'string' ? note.config.description : ''
    notes.push({
      id,
      title: note.title,
      description,
      noteUuid: note.uuid
    })
  }

  return { notes, missingIds }
}

export async function saveNote(
  handle: KnowledgeBaseHandle,
  request: NoteSaveRequest,
  effects: MutationSideEffects
): Promise<NoteMutationDto> {
  const settings = loadSettings()
  const override = settingsForKnowledgeBase(settings, handle.snapshot.id)
  const result = await handle.workspace.notes.save({
    noteUuid: request.noteUuid,
    content: request.content,
    expectedRevision: request.expectedRevision,
    prettier: request.prettier ?? override.prettier ?? settings.prettier
  })
  return applyNoteMutation(handle, result, effects)
}

export async function createNote(
  handle: KnowledgeBaseHandle,
  request: NoteCreateRequest,
  effects: MutationSideEffects
): Promise<NoteMutationDto> {
  const result = await handle.workspace.notes.create({
    title: request.title,
    placement: request.placement as NotePlacement | undefined,
    expectedSnapshotRevision: request.expectedSnapshotRevision
  })
  return applyNoteMutation(handle, result, effects)
}

export async function renameNote(
  handle: KnowledgeBaseHandle,
  request: NoteRenameRequest,
  effects: MutationSideEffects
): Promise<NoteMutationDto> {
  const result = await handle.workspace.notes.rename({
    noteUuid: request.noteUuid,
    title: request.title,
    expectedRevision: request.expectedRevision
  })
  return applyNoteMutation(handle, result, effects)
}

export async function updateNoteConfig(
  handle: KnowledgeBaseHandle,
  request: NoteUpdateConfigRequest,
  effects: MutationSideEffects
): Promise<NoteMutationDto> {
  const result = await handle.workspace.notes.updateConfig({
    noteUuid: request.noteUuid,
    updates: request.updates,
    expectedRevision: request.expectedRevision
  })
  return applyNoteMutation(handle, result, effects)
}

export async function writeLocalAttachment(
  handle: KnowledgeBaseHandle,
  request: AttachmentWriteLocalRequest,
  effects: MutationSideEffects
): Promise<AttachmentWriteLocalResult> {
  const result = await handle.workspace.attachments.writeLocal({
    noteUuid: request.noteUuid,
    fileName: request.fileName,
    data: request.data
  })
  effects.markInternalWrites(result.changedFiles)
  handle.snapshot = await handle.workspace.refresh()
  effects.emitChanged()
  return result.value
}

export async function resolveNoteAsset(
  handle: KnowledgeBaseHandle,
  noteUuid: string,
  requestedPath: string
): Promise<string> {
  const absolutePath = await resolvePathInsideNote(handle, noteUuid, requestedPath)
  const extension = path.extname(absolutePath).toLocaleLowerCase()
  const supported = new Set([
    '.avif',
    '.bmp',
    '.gif',
    '.ico',
    '.jpeg',
    '.jpg',
    '.png',
    '.svg',
    '.webp'
  ])
  if (!supported.has(extension)) throw new Error('不支持的图片类型')
  const stat = await fs.stat(absolutePath)
  if (!stat.isFile()) throw new Error('图片不存在')
  return absolutePath
}

export async function readNoteTextAsset(
  handle: KnowledgeBaseHandle,
  request: AttachmentReadTextRequest
): Promise<string> {
  const absolutePath = await resolvePathInsideNote(handle, request.noteUuid, request.path)
  const stat = await fs.stat(absolutePath)
  if (!stat.isFile()) throw new Error('引用文件不存在')
  if (stat.size > 2 * 1024 * 1024) throw new Error('引用文件不能超过 2 MB')
  const content = await fs.readFile(absolutePath, 'utf8')
  if (content.includes('\0')) throw new Error('引用文件不是文本文件')
  return content
}

export async function writeNoteTextAsset(
  handle: KnowledgeBaseHandle,
  request: AttachmentWriteTextRequest,
  markInternalWrites: (changedFiles: ChangedFile[]) => void
): Promise<void> {
  if (Buffer.byteLength(request.content, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('引用文件不能超过 2 MB')
  }
  if (request.content.includes('\0')) throw new Error('引用文件不是文本文件')
  const absolutePath = await resolvePathInsideNote(handle, request.noteUuid, request.path)
  const stat = await fs.stat(absolutePath)
  if (!stat.isFile()) throw new Error('引用文件不存在')
  markInternalWrites([{ path: absolutePath, kind: 'updated' }])
  await fs.writeFile(absolutePath, request.content, 'utf8')
}
