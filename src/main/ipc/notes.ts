import { clipboard, shell } from 'electron'
import { z } from 'zod'

import { gitManager } from '../gitManager'
import { imageBedManager } from '../imageBed'
import { workspaceManager } from '../workspaceManager'
import { IPC_CHANNELS } from '../../shared/contracts'
import {
  attachmentReadTextSchema,
  attachmentWriteLocalSchema,
  attachmentWriteTextSchema,
  entryRefSchema,
  noteCreateSchema,
  noteRenameSchema,
  noteSaveSchema,
  noteUpdateConfigSchema,
  tocCreateGroupSchema,
  tocDeleteSchema,
  tocMoveSchema,
  tocRenameGroupSchema
} from './schemas'
import { handle, type GetWindow } from './shared'

import type {
  AttachmentWriteLocalRequest,
  AttachmentReadTextRequest,
  AttachmentWriteTextRequest,
  ImageUploadRequest,
  NoteCreateRequest,
  NoteRenameRequest,
  NoteSaveRequest,
  NoteUpdateConfigRequest,
  TocCreateGroupRequest,
  TocDeleteRequest,
  TocEntryRefDto,
  TocMoveRequest,
  TocRenameGroupRequest
} from '../../shared/contracts'

export function registerNotes(getWindow: GetWindow): void {
  handle(
    IPC_CHANNELS.noteRead,
    getWindow,
    z.object({
      knowledgeBaseId: z.string().min(1),
      noteUuid: z.string().min(1)
    }),
    ({ knowledgeBaseId, noteUuid }) => workspaceManager.readNote(knowledgeBaseId, noteUuid)
  )
  handle(
    IPC_CHANNELS.noteResolveTable,
    getWindow,
    z.object({
      knowledgeBaseId: z.string().min(1),
      ids: z.array(z.string())
    }),
    ({ knowledgeBaseId, ids }) => workspaceManager.resolveNotesTable(knowledgeBaseId, ids)
  )
  handle(IPC_CHANNELS.noteSave, getWindow, noteSaveSchema, (input) =>
    workspaceManager.saveNote(input as NoteSaveRequest)
  )
  handle(IPC_CHANNELS.noteCreate, getWindow, noteCreateSchema, (input) =>
    workspaceManager.createNote(input as NoteCreateRequest)
  )
  handle(IPC_CHANNELS.noteRename, getWindow, noteRenameSchema, (input) =>
    workspaceManager.renameNote(input as NoteRenameRequest)
  )
  handle(IPC_CHANNELS.noteUpdateConfig, getWindow, noteUpdateConfigSchema, (input) =>
    workspaceManager.updateNoteConfig(input as NoteUpdateConfigRequest)
  )
  handle(
    IPC_CHANNELS.noteCopyDirectoryPath,
    getWindow,
    z.object({ knowledgeBaseId: z.string().min(1), noteUuid: z.string().min(1) }),
    ({ knowledgeBaseId, noteUuid }) => {
      const directoryPath = workspaceManager.getNoteLocation(knowledgeBaseId, noteUuid)
      clipboard.writeText(directoryPath)
      return directoryPath
    }
  )
  handle(
    IPC_CHANNELS.noteRevealInFileManager,
    getWindow,
    z.object({ knowledgeBaseId: z.string().min(1), noteUuid: z.string().min(1) }),
    async ({ knowledgeBaseId, noteUuid }) => {
      const note = await workspaceManager.readNote(knowledgeBaseId, noteUuid)
      shell.showItemInFolder(note.readmePath)
    }
  )
  handle(IPC_CHANNELS.attachmentWriteLocal, getWindow, attachmentWriteLocalSchema, (input) =>
    workspaceManager.writeLocalAttachment(input as AttachmentWriteLocalRequest)
  )
  handle(IPC_CHANNELS.attachmentUploadImage, getWindow, attachmentWriteLocalSchema, (input) =>
    imageBedManager.upload(input as ImageUploadRequest)
  )
  handle(IPC_CHANNELS.attachmentReadText, getWindow, attachmentReadTextSchema, (input) =>
    workspaceManager.readNoteTextAsset(input as AttachmentReadTextRequest)
  )
  handle(IPC_CHANNELS.attachmentWriteText, getWindow, attachmentWriteTextSchema, (input) =>
    workspaceManager.writeNoteTextAsset(input as AttachmentWriteTextRequest)
  )

  handle(IPC_CHANNELS.tocMove, getWindow, tocMoveSchema, (input) =>
    workspaceManager.moveToc(input as TocMoveRequest)
  )
  handle(IPC_CHANNELS.tocCreateGroup, getWindow, tocCreateGroupSchema, (input) =>
    workspaceManager.createTocGroup(input as TocCreateGroupRequest)
  )
  handle(IPC_CHANNELS.tocRenameGroup, getWindow, tocRenameGroupSchema, (input) =>
    workspaceManager.renameTocGroup(input as TocRenameGroupRequest)
  )
  handle(
    IPC_CHANNELS.tocPreviewDelete,
    getWindow,
    z.object({
      knowledgeBaseId: z.string().min(1),
      entry: entryRefSchema
    }),
    async ({ knowledgeBaseId, entry }) => {
      const preview = await workspaceManager.previewDelete(knowledgeBaseId, entry as TocEntryRefDto)
      return {
        ...preview,
        untrackedFilePaths: gitManager.untrackedFilesInside(knowledgeBaseId, [
          ...preview.filePaths,
          ...preview.directoryPaths
        ])
      }
    }
  )
  handle(IPC_CHANNELS.tocDelete, getWindow, tocDeleteSchema, (input) =>
    workspaceManager.deleteToc(input as TocDeleteRequest)
  )
}
