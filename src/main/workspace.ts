import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface WorkspaceState {
  path: string | null
}

function statePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'workspace.json')
}

export function loadWorkspace(): WorkspaceState {
  try {
    const raw = readFileSync(statePath(), 'utf-8')
    const data = JSON.parse(raw) as WorkspaceState
    if (data.path && !existsSync(data.path)) {
      return { path: null }
    }
    return { path: data.path ?? null }
  } catch {
    return { path: null }
  }
}

export function saveWorkspace(path: string | null): WorkspaceState {
  const state: WorkspaceState = { path }
  writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8')
  return state
}
