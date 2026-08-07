import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type TocNode =
  | { type: 'group'; title: string; children: TocNode[] }
  | {
      type: 'note'
      title: string
      noteDir: string
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
  status: GitStatus
}

export interface AppSettings {
  blacklist: string[]
}

const api = {
  getWorkspace: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:get'),
  chooseWorkspace: (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:choose'),
  setWorkspace: (path: string | null): Promise<WorkspaceState> =>
    ipcRenderer.invoke('workspace:set', path),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (next: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', next),
  listKnowledge: (): Promise<string[]> => ipcRenderer.invoke('knowledge:list'),
  scanKnowledge: (): Promise<string[]> => ipcRenderer.invoke('knowledge:scan'),
  readToc: (repoName: string): Promise<TocNode[]> => ipcRenderer.invoke('toc:read', repoName),
  readNote: (repoName: string, noteDir: string): Promise<NotePayload> =>
    ipcRenderer.invoke('note:read', repoName, noteDir),
  writeNote: (
    repoName: string,
    noteDir: string,
    content: string
  ): Promise<{ path: string; ok: boolean }> =>
    ipcRenderer.invoke('note:write', repoName, noteDir, content),
  gitStatus: (repoName: string): Promise<GitStatus> => ipcRenderer.invoke('git:status', repoName),
  gitStatusAll: (): Promise<GitStatus[]> => ipcRenderer.invoke('git:status-all'),
  gitPull: (repoName: string): Promise<GitCommandResult> =>
    ipcRenderer.invoke('git:pull', repoName),
  gitPush: (repoName: string): Promise<GitCommandResult> => ipcRenderer.invoke('git:push', repoName)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error fallback without context isolation
  window.electron = electronAPI
  // @ts-expect-error fallback without context isolation
  window.api = api
}
