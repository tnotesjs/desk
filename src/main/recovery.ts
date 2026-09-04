import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

import type {
  RecoveryDeleteRequest,
  RecoveryRecord,
  RecoveryWriteRequest
} from '../shared/contracts'

const recoveryOperations = new Map<string, Promise<void>>()

function enqueueRecovery(target: string, operation: () => Promise<void>): Promise<void> {
  const pending = (recoveryOperations.get(target) ?? Promise.resolve())
    .catch(() => undefined)
    .then(operation)
    .finally(() => {
      if (recoveryOperations.get(target) === pending) recoveryOperations.delete(target)
    })
  recoveryOperations.set(target, pending)
  return pending
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function workspaceDirectory(workspacePath: string): string {
  return path.join(app.getPath('userData'), 'recovery', digest(path.resolve(workspacePath)))
}

function recoveryPath(
  workspacePath: string,
  knowledgeBaseId: string,
  noteUuid: string,
  resourcePath?: string
): string {
  return path.join(
    workspaceDirectory(workspacePath),
    `${digest(resourcePath ? `${knowledgeBaseId}:${noteUuid}:${resourcePath}` : `${knowledgeBaseId}:${noteUuid}`)}.json`
  )
}

export async function loadRecoveries(workspacePath: string | null): Promise<RecoveryRecord[]> {
  if (!workspacePath) return []
  const directory = workspaceDirectory(workspacePath)
  const names = await fs.readdir(directory).catch(() => [])
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name): Promise<RecoveryRecord | null> => {
        try {
          const value = JSON.parse(
            await fs.readFile(path.join(directory, name), 'utf8')
          ) as Partial<RecoveryRecord>
          if (
            value.version !== 1 ||
            typeof value.knowledgeBaseId !== 'string' ||
            typeof value.noteUuid !== 'string' ||
            typeof value.title !== 'string' ||
            typeof value.content !== 'string' ||
            typeof value.revision !== 'string' ||
            typeof value.updatedAt !== 'string'
          ) {
            return null
          }
          return value as RecoveryRecord
        } catch {
          return null
        }
      })
  )
  return records
    .filter((record): record is RecoveryRecord => Boolean(record))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function writeRecovery(
  workspacePath: string | null,
  request: RecoveryWriteRequest
): Promise<void> {
  if (!workspacePath) return Promise.resolve()
  const target = recoveryPath(
    workspacePath,
    request.knowledgeBaseId,
    request.noteUuid,
    request.path
  )
  return enqueueRecovery(target, () => performWriteRecovery(workspacePath, request))
}

async function performWriteRecovery(
  workspacePath: string | null,
  request: RecoveryWriteRequest
): Promise<void> {
  if (!workspacePath) return
  const directory = workspaceDirectory(workspacePath)
  await fs.mkdir(directory, { recursive: true })
  const target = recoveryPath(
    workspacePath,
    request.knowledgeBaseId,
    request.noteUuid,
    request.path
  )
  const temporary = `${target}.${process.pid}.tmp`
  const record: RecoveryRecord = {
    version: 1,
    ...request,
    updatedAt: new Date().toISOString()
  }
  await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, 'utf8')
  await fs.rename(temporary, target)
}

export function deleteRecovery(
  workspacePath: string | null,
  request: RecoveryDeleteRequest
): Promise<void> {
  if (!workspacePath) return Promise.resolve()
  const target = recoveryPath(
    workspacePath,
    request.knowledgeBaseId,
    request.noteUuid,
    request.path
  )
  return enqueueRecovery(target, () =>
    fs.unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  )
}
