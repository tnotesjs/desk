import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

import { deskLog } from './log'

import type { WorkspaceSession } from '../shared/contracts'

function sessionPath(workspacePath: string): string {
  const workspaceId = createHash('sha256').update(workspacePath).digest('hex').slice(0, 20)
  return path.join(app.getPath('userData'), 'sessions', `${workspaceId}.json`)
}

export async function loadWorkspaceSession(
  workspacePath: string | null
): Promise<WorkspaceSession | null> {
  if (!workspacePath) return null
  const targetPath = sessionPath(workspacePath)
  try {
    const raw = await fs.readFile(targetPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceSession>
    if (parsed.version !== 1 || !parsed.layout || typeof parsed.activeGroupId !== 'string') {
      return null
    }
    return parsed as WorkspaceSession
  } catch {
    deskLog('session', 'no saved session', { workspacePath, targetPath })
    return null
  }
}

export async function saveWorkspaceSession(
  workspacePath: string | null,
  session: WorkspaceSession
): Promise<void> {
  if (!workspacePath) return
  const targetPath = sessionPath(workspacePath)
  const directoryPath = path.dirname(targetPath)
  await fs.mkdir(directoryPath, { recursive: true })
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await fs.rename(temporaryPath, targetPath)
  deskLog('session', 'saved', { workspacePath, groups: countGroups(session.layout) })
}

function countGroups(node: WorkspaceSession['layout']): number {
  return node.type === 'group' ? 1 : countGroups(node.first) + countGroups(node.second)
}
