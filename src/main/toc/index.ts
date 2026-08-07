export type { NoteConfig, NoteInfo } from './types'
export type { DeskTocNode, MoveTocEntryTarget, NoteInsertPlacement } from './service'
export {
  readDeskToc,
  createNotes,
  createFolder,
  renameNote,
  renameFolder,
  deleteNote,
  deleteEntry,
  reorderByNodeId,
  regenerateSidebar
} from './service'
