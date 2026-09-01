import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createWorkspace } from '@tnotesjs/core/workspace'

import { deskLog } from '../log'

import { stablePathSuffix } from './dto'
import { KNOWLEDGE_BASE_NAME, type KnowledgeBaseHandle, type WorkspaceManagerEvents } from './types'

import type { ChangedFile } from '@tnotesjs/core/workspace'

/** Mutable runtime state shared between WorkspaceManager and scan/watch helpers. */
export interface WorkspaceScanState {
  handles: Map<string, KnowledgeBaseHandle>
  workspacePath: string | null
  watchers: Map<string, FSWatcher>
  refreshTimer: NodeJS.Timeout | null
  scanTail: Promise<void>
  internalWriteUntil: Map<string, number>
  lastWatcherError: string
  lastWatcherErrorAt: number
  events: EventEmitter<WorkspaceManagerEvents>
  emitChanged: () => void
}

export function markInternalWrites(state: WorkspaceScanState, changedFiles: ChangedFile[]): void {
  const until = Date.now() + 1500
  for (const changed of changedFiles) {
    state.internalWriteUntil.set(path.normalize(changed.path), until)
    if (changed.previousPath) {
      state.internalWriteUntil.set(path.normalize(changed.previousPath), until)
    }
  }
}

/** 笔记配置缺失/损坏 → 触发 files→TOC 对齐（0004）。 */
export async function reconcileIfNeeded(handle: KnowledgeBaseHandle): Promise<void> {
  const snapshot = handle.snapshot
  const hasConfigDiagnostics = snapshot.health.diagnostics.some(
    (d) => d.code === 'NOTE_CONFIG_MISSING' || d.code === 'NOTE_CONFIG_INVALID'
  )
  if (!hasConfigDiagnostics) return
  try {
    const result = await handle.workspace.toc.reconcileFromFiles()
    handle.snapshot = result.value
  } catch (error) {
    deskLog('workspace', 'reconcile failed', error instanceof Error ? error.message : String(error))
  }
}

export async function scan(state: WorkspaceScanState): Promise<void> {
  if (!state.workspacePath) return
  const entries = await fs.readdir(state.workspacePath, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isDirectory() && KNOWLEDGE_BASE_NAME.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
  const previousByPath = new Map(
    [...state.handles.values()].map((handle) => [handle.rootPath, handle])
  )
  const next = new Map<string, KnowledgeBaseHandle>()

  for (const candidate of candidates) {
    const rootPath = path.join(state.workspacePath, candidate.name)
    const existing = previousByPath.get(rootPath)
    const workspace = existing?.workspace ?? createWorkspace({ rootPath })
    const snapshot = await workspace.inspect()
    let id = existing?.id ?? snapshot.id
    if (next.has(id)) id = `${snapshot.id}:${stablePathSuffix(rootPath)}`
    const handle = {
      id,
      name: candidate.name,
      rootPath,
      workspace,
      snapshot
    }
    next.set(id, handle)
    // 0004：文件系统为准——笔记配置缺失/损坏时先做 files→TOC 对齐
    // （自动软删无效笔记到 notes/.trash/ 并恢复健康）。
    await reconcileIfNeeded(handle)
    previousByPath.delete(rootPath)
  }

  await Promise.all([...previousByPath.values()].map((handle) => handle.workspace.dispose()))
  state.handles = next
  syncKnowledgeBaseWatchers(state)
  deskLog('workspace', 'scan complete', {
    path: state.workspacePath,
    knowledgeBases: next.size
  })
}

export async function enqueueScan(state: WorkspaceScanState): Promise<void> {
  state.scanTail = state.scanTail
    .then(() => scan(state))
    .catch((error) => {
      deskLog('workspace', 'scan failed', error instanceof Error ? error.message : String(error))
    })
  await state.scanTail
}

export function startWatchers(state: WorkspaceScanState, workspacePath: string): void {
  createWatcher(state, 'workspace', workspacePath, false, (_event, fileName) => {
    if (!fileName) return
    const [topLevelName] = fileName.toString().split(path.sep)
    if (topLevelName && KNOWLEDGE_BASE_NAME.test(topLevelName)) {
      scheduleRefresh(state)
    }
  })
  syncKnowledgeBaseWatchers(state)
}

function createWatcher(
  state: WorkspaceScanState,
  key: string,
  targetPath: string,
  recursive: boolean,
  listener: (eventType: 'rename' | 'change', fileName: string | null) => void
): void {
  if (state.watchers.has(key)) return
  let watcher: FSWatcher
  try {
    watcher = watch(targetPath, { recursive }, listener)
  } catch (error) {
    logWatcherError(state, error)
    return
  }
  watcher.on('error', (error) => logWatcherError(state, error))
  state.watchers.set(key, watcher)
}

function logWatcherError(state: WorkspaceScanState, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const now = Date.now()
  if (message !== state.lastWatcherError || now - state.lastWatcherErrorAt > 5000) {
    state.lastWatcherError = message
    state.lastWatcherErrorAt = now
    deskLog('workspace:watcher', 'error', message)
  }
}

export function syncKnowledgeBaseWatchers(state: WorkspaceScanState): void {
  if (!state.workspacePath || !state.watchers.has('workspace')) return
  const expectedKeys = new Set(['workspace'])
  for (const handle of state.handles.values()) {
    const key = `knowledge-base:${handle.rootPath}`
    expectedKeys.add(key)
    createWatcher(state, key, handle.rootPath, true, (_event, fileName) => {
      if (!fileName) return
      const relativePath = fileName.toString()
      if (shouldIgnoreKnowledgeBasePath(relativePath)) return
      handleWatchedPath(state, path.join(handle.rootPath, relativePath))
    })
  }

  for (const [key, watcher] of state.watchers) {
    if (!expectedKeys.has(key)) {
      watcher.close()
      state.watchers.delete(key)
    }
  }
}

function shouldIgnoreKnowledgeBasePath(relativePath: string): boolean {
  const segments = relativePath.split(path.sep).filter(Boolean)
  return segments.some((segment, index) => {
    if (segment === '.git' || segment === 'node_modules' || segment === 'dist') return true
    return segment === 'cache' && segments[index - 1] === '.vitepress'
  })
}

function handleWatchedPath(state: WorkspaceScanState, changedPath: string): void {
  const normalizedPath = path.normalize(changedPath)
  const internalUntil = state.internalWriteUntil.get(normalizedPath) ?? 0
  if (internalUntil < Date.now()) {
    state.internalWriteUntil.delete(normalizedPath)
    if (path.basename(normalizedPath) === 'README.md') {
      for (const handle of state.handles.values()) {
        const note = handle.snapshot.notes.find(
          (item) => path.normalize(item.readmePath) === normalizedPath
        )
        if (note) {
          state.events.emit('noteExternalChanged', {
            knowledgeBaseId: handle.id,
            noteUuid: note.uuid
          })
          break
        }
      }
    }
  }

  scheduleRefresh(state)
}

export function scheduleRefresh(state: WorkspaceScanState): void {
  if (state.refreshTimer) clearTimeout(state.refreshTimer)
  state.refreshTimer = setTimeout(() => {
    state.refreshTimer = null
    void enqueueScan(state).then(() => state.emitChanged())
  }, 250)
}

export async function stopWatcher(state: WorkspaceScanState): Promise<void> {
  for (const watcher of state.watchers.values()) watcher.close()
  state.watchers.clear()
}

export async function disposeHandles(state: WorkspaceScanState): Promise<void> {
  await Promise.all([...state.handles.values()].map((handle) => handle.workspace.dispose()))
  state.handles.clear()
}
