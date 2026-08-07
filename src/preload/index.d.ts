import { ElectronAPI } from '@electron-toolkit/preload'

export type TocNode =
  | {
      type: 'group'
      title: string
      tocLineIndex: number
      nodeId: string
      folderPath: string[]
      children: TocNode[]
    }
  | {
      type: 'note'
      title: string
      noteDir: string
      noteIndex: string
      tocLineIndex: number
      nodeId: string
      completed: boolean
      children: TocNode[]
    }

export interface WorkspaceState {
  path: string | null
}

export interface NotePayload {
  path: string
  content: string
}

export interface GitStatus {
  repo: string
  isRepo: boolean
  branch: string | null
  clean: boolean
  changed: number
  ahead: number
  behind: number
  error: string | null
}

export interface GitCommandResult {
  ok: boolean
  stdout: string
  stderr: string
  error: string | null
  message: string | null
  status: GitStatus
}

export interface AppSettings {
  blacklist: string[]
}

export type PreviewRuntimeStatus = 'idle' | 'starting' | 'ready' | 'error'

export interface PreviewState {
  repo: string | null
  port: number | null
  status: PreviewRuntimeStatus
  error: string | null
  baseUrl: string | null
}

export interface DeskApi {
  getWorkspace: () => Promise<WorkspaceState>
  chooseWorkspace: () => Promise<WorkspaceState>
  setWorkspace: (path: string | null) => Promise<WorkspaceState>
  getSettings: () => Promise<AppSettings>
  setSettings: (next: Partial<AppSettings>) => Promise<AppSettings>
  listKnowledge: () => Promise<string[]>
  scanKnowledge: () => Promise<string[]>
  readToc: (repoName: string) => Promise<TocNode[]>
  tocCreateNotes: (
    repoName: string,
    options: {
      count?: number
      title?: string
      parentTocLineIndex?: number
      aroundNoteIndex?: string
      placement?: 'before' | 'after'
    }
  ) => Promise<TocNode[]>
  tocCreateFolder: (
    repoName: string,
    options: { title: string; parentTocLineIndex?: number }
  ) => Promise<TocNode[]>
  tocRenameNote: (repoName: string, noteIndex: string, newTitle: string) => Promise<TocNode[]>
  tocRenameFolder: (repoName: string, tocLineIndex: number, newTitle: string) => Promise<TocNode[]>
  tocDeleteNote: (repoName: string, noteIndex: string) => Promise<TocNode[]>
  tocDeleteEntry: (repoName: string, tocLineIndex: number) => Promise<TocNode[]>
  tocReorder: (
    repoName: string,
    payload: { nodeId: string; action: 'moveAfter' | 'prependChild'; targetNodeId?: string }
  ) => Promise<TocNode[]>
  readNote: (repoName: string, noteDir: string) => Promise<NotePayload>
  writeNote: (
    repoName: string,
    noteDir: string,
    content: string
  ) => Promise<{ path: string; ok: boolean }>
  gitStatus: (repoName: string) => Promise<GitStatus>
  gitStatusAll: () => Promise<GitStatus[]>
  gitPull: (repoName: string) => Promise<GitCommandResult>
  gitPush: (repoName: string) => Promise<GitCommandResult>
  previewStatus: () => Promise<PreviewState>
  previewStart: (repoName: string) => Promise<PreviewState>
  previewStop: () => Promise<PreviewState>
  previewNoteUrl: (repoName: string, noteDir: string) => Promise<string>
  onLog: (callback: (line: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DeskApi
  }
}
