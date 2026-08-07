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
