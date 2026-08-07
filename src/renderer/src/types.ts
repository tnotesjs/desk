export type TocNode =
  | { type: 'group'; title: string; children: TocNode[] }
  | {
      type: 'note'
      title: string
      noteDir: string
      completed: boolean
      children: TocNode[]
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

export type NoteViewMode = 'code' | 'preview'

export type PreviewRuntimeStatus = 'idle' | 'starting' | 'ready' | 'error'

export interface PreviewState {
  repo: string | null
  port: number | null
  status: PreviewRuntimeStatus
  error: string | null
  baseUrl: string | null
}
