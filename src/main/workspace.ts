import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WorkspaceState {
  path: string | null
}

function statePath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'workspace.v1.json')
}

function legacyStatePath(): string {
  return join(app.getPath('userData'), 'workspace.json')
}

function readState(filePath: string): WorkspaceState | null {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8')) as WorkspaceState
    if (data.path !== null && typeof data.path !== 'string') return null
    if (data.path && !existsSync(data.path)) return { path: null }
    return { path: data.path ?? null }
  } catch {
    return null
  }
}

export function loadWorkspace(): WorkspaceState {
  return readState(statePath()) ?? readState(legacyStatePath()) ?? { path: null }
}

export function saveWorkspace(path: string | null): WorkspaceState {
  const state: WorkspaceState = { path }
  const target = statePath()
  const temporary = `${target}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(temporary, target)
  return state
}
