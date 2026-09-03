import { createHash, randomUUID } from 'node:crypto'
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
  NoteFileEntryDto,
  NoteFileReadTextRequest,
  NoteFileSaveTextRequest,
  NoteFilesListRequest,
  NoteTextFileDto,
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

interface NoteFilesWorkspaceApi {
  list(input: {
    noteUuid: string
    directory?: string
  }): Promise<
    Array<{ name: string; path: string; kind: 'directory' | 'file'; size: number | null }>
  >
  readText(input: {
    noteUuid: string
    path: string
  }): Promise<{ noteUuid: string; path: string; content: string; revision: string; size: number }>
  saveText(input: {
    noteUuid: string
    path: string
    content: string
    expectedRevision: string
  }): Promise<{
    value: { noteUuid: string; path: string; content: string; revision: string; size: number }
    changedFiles: ChangedFile[]
  }>
}

function optionalNoteFilesApi(handle: KnowledgeBaseHandle): NoteFilesWorkspaceApi | undefined {
  return (handle.workspace as typeof handle.workspace & { noteFiles?: NoteFilesWorkspaceApi })
    .noteFiles
}

function normalizedNoteFilePath(filePath: string): string {
  if (filePath.includes('\0') || path.isAbsolute(filePath) || /^(?:[a-z]+:|\/\/)/i.test(filePath)) {
    throw new Error('笔记文件路径无效')
  }
  const segments = filePath
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment && segment !== '.')
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '..' || segment.toLocaleLowerCase() === '.git')
  ) {
    throw new Error('笔记文件路径无效')
  }
  return segments.join('/')
}

function textRevision(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

async function writeTextAtomically(filePath: string, content: string, mode: number): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  )
  const file = await fs.open(temporaryPath, 'wx')
  try {
    await file.writeFile(content, 'utf8')
    await file.chmod(mode)
    await file.sync()
  } catch (cause) {
    await file.close().catch(() => undefined)
    await fs.rm(temporaryPath, { force: true })
    throw cause
  }
  await file.close()
  try {
    await fs.rename(temporaryPath, filePath)
  } catch (cause) {
    await fs.rm(temporaryPath, { force: true })
    throw cause
  }
}

export async function resolvePathInsideNote(
  handle: KnowledgeBaseHandle,
  noteUuid: string,
  requestedPath: string
): Promise<string> {
  return (await resolveNoteFileLocation(handle, noteUuid, requestedPath)).absolutePath
}

async function resolveNoteFileLocation(
  handle: KnowledgeBaseHandle,
  noteUuid: string,
  requestedPath: string
): Promise<{ absolutePath: string; relativePath: string }> {
  const note = await handle.workspace.notes.read(noteUuid)
  const absolutePath = await resolvePathInsideDirectory(note.directoryPath, requestedPath)
  const noteRoot = await fs.realpath(note.directoryPath)
  return {
    absolutePath,
    relativePath: path.relative(noteRoot, absolutePath).split(path.sep).join('/')
  }
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
  const api = optionalNoteFilesApi(handle)
  if (api) {
    return (
      await api.readText({
        noteUuid: request.noteUuid,
        path: request.path
      })
    ).content
  }
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
  const api = optionalNoteFilesApi(handle)
  if (!api) {
    if (Buffer.byteLength(request.content, 'utf8') > 2 * 1024 * 1024) {
      throw new Error('引用文件不能超过 2 MB')
    }
    if (request.content.includes('\0')) throw new Error('引用文件不是文本文件')
    const absolutePath = await resolvePathInsideNote(handle, request.noteUuid, request.path)
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) throw new Error('引用文件不存在')
    markInternalWrites([{ path: absolutePath, kind: 'updated' }])
    await fs.writeFile(absolutePath, request.content, 'utf8')
    return
  }
  const current = await api.readText({
    noteUuid: request.noteUuid,
    path: request.path
  })
  const result = await api.saveText({
    noteUuid: request.noteUuid,
    path: request.path,
    content: request.content,
    expectedRevision: current.revision
  })
  markInternalWrites(result.changedFiles)
}

const IMAGE_EXTENSIONS = new Set([
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

const TEXT_EXTENSIONS = new Set([
  '',
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
])

function classifyNoteFile(filePath: string): 'text' | 'image' | 'unsupported' {
  const extension = path.extname(filePath).toLocaleLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  return 'unsupported'
}

export async function listNoteFiles(
  handle: KnowledgeBaseHandle,
  request: NoteFilesListRequest
): Promise<NoteFileEntryDto[]> {
  const api = optionalNoteFilesApi(handle)
  const entries = api
    ? await api.list({
        noteUuid: request.noteUuid,
        directory: request.directory
      })
    : await (async () => {
        const requestedDirectory = request.directory
          ? normalizedNoteFilePath(request.directory)
          : '.'
        const { absolutePath, relativePath: directory } = await resolveNoteFileLocation(
          handle,
          request.noteUuid,
          requestedDirectory
        )
        const stat = await fs.stat(absolutePath)
        if (!stat.isDirectory()) throw new Error('目标不是笔记目录')
        const children = await fs.readdir(absolutePath, { withFileTypes: true })
        const visible = await Promise.all(
          children
            .filter(
              (entry) =>
                !entry.name.startsWith('.') &&
                entry.name !== 'node_modules' &&
                !entry.isSymbolicLink() &&
                (entry.isDirectory() || entry.isFile())
            )
            .map(async (entry) => ({
              name: entry.name,
              path: directory ? `${directory}/${entry.name}` : entry.name,
              kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
              size: entry.isFile()
                ? (await fs.stat(path.join(absolutePath, entry.name))).size
                : null
            }))
        )
        return visible.sort((left, right) => {
          if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
          return left.name.localeCompare(right.name, undefined, {
            numeric: true,
            sensitivity: 'base'
          })
        })
      })()
  return entries.map((entry) => ({
    ...entry,
    fileKind: entry.kind === 'file' ? classifyNoteFile(entry.path) : null
  }))
}

export async function readNoteTextFile(
  handle: KnowledgeBaseHandle,
  request: NoteFileReadTextRequest
): Promise<NoteTextFileDto> {
  const api = optionalNoteFilesApi(handle)
  const document = api
    ? await api.readText({ noteUuid: request.noteUuid, path: request.path })
    : await (async () => {
        const requestedPath = normalizedNoteFilePath(request.path)
        const { absolutePath, relativePath } = await resolveNoteFileLocation(
          handle,
          request.noteUuid,
          requestedPath
        )
        const stat = await fs.stat(absolutePath)
        if (!stat.isFile()) throw new Error('目标不是笔记文件')
        if (stat.size > 2 * 1024 * 1024) throw new Error('笔记文件不能超过 2 MB')
        const data = await fs.readFile(absolutePath)
        if (data.includes(0)) throw new Error('笔记文件不是文本文件')
        return {
          noteUuid: request.noteUuid,
          path: relativePath,
          content: data.toString('utf8'),
          revision: textRevision(data),
          size: data.byteLength
        }
      })()
  return {
    knowledgeBaseId: handle.id,
    ...document,
    readOnly: handle.snapshot.health.status !== 'ready'
  }
}

export async function saveNoteTextFile(
  handle: KnowledgeBaseHandle,
  request: NoteFileSaveTextRequest,
  effects: MutationSideEffects
): Promise<NoteTextFileDto> {
  const api = optionalNoteFilesApi(handle)
  if (!api) {
    const requestedPath = normalizedNoteFilePath(request.path)
    if (Buffer.byteLength(request.content, 'utf8') > 2 * 1024 * 1024) {
      throw new Error('笔记文件不能超过 2 MB')
    }
    if (request.content.includes('\0')) throw new Error('笔记文件不是文本文件')
    const { absolutePath, relativePath } = await resolveNoteFileLocation(
      handle,
      request.noteUuid,
      requestedPath
    )
    const lowerPath = relativePath.toLocaleLowerCase()
    if (lowerPath === 'readme.md' || lowerPath === '.tnotes.json') {
      throw new Error(
        lowerPath === 'readme.md'
          ? 'README.md 必须通过笔记保存接口修改'
          : '笔记配置不能通过通用文件接口修改'
      )
    }
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) throw new Error('目标不是笔记文件')
    const current = await fs.readFile(absolutePath)
    if (textRevision(current) !== request.expectedRevision) {
      const conflict = new Error('笔记文件已被其他程序修改') as Error & { code: string }
      conflict.code = 'REVISION_CONFLICT'
      throw conflict
    }
    effects.markInternalWrites([{ path: absolutePath, kind: 'updated' }])
    await writeTextAtomically(absolutePath, request.content, stat.mode)
    const document = await readNoteTextFile(handle, request)
    effects.emitChanged()
    return document
  }
  const result = await api.saveText({
    noteUuid: request.noteUuid,
    path: request.path,
    content: request.content,
    expectedRevision: request.expectedRevision
  })
  effects.markInternalWrites(result.changedFiles)
  handle.snapshot = await handle.workspace.refresh()
  effects.emitChanged()
  return {
    knowledgeBaseId: handle.id,
    ...result.value,
    readOnly: handle.snapshot.health.status !== 'ready'
  }
}
