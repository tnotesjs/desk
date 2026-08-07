import { dialog, ipcMain } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getGitStatus, gitPull, gitPush, type GitStatus } from './git'
import { deskLog } from './log'
import { buildNotePreviewUrl, previewManager } from './preview'
import { loadSettings, saveSettings } from './settings'
import {
  createFolder,
  createNotes,
  deleteEntry,
  deleteNote,
  readDeskToc,
  renameFolder,
  renameNote,
  reorderByNodeId,
  type DeskTocNode
} from './toc'
import { loadWorkspace, saveWorkspace } from './workspace'

const TN_DIR = /^TNotes\./

function assertWorkspace(workspacePath: string | null): string {
  if (!workspacePath) {
    throw new Error('未选择工作区')
  }
  if (!existsSync(workspacePath)) {
    throw new Error(`工作区不存在: ${workspacePath}`)
  }
  return workspacePath
}

function repoPath(workspacePath: string, repoName: string): string {
  if (
    !TN_DIR.test(repoName) ||
    repoName.includes('..') ||
    repoName.includes('/') ||
    repoName.includes('\\')
  ) {
    throw new Error(`非法知识库名: ${repoName}`)
  }
  const full = join(workspacePath, repoName)
  if (!existsSync(full)) {
    throw new Error(`知识库不存在: ${repoName}`)
  }
  return full
}

function noteReadmePath(workspacePath: string, repoName: string, noteDir: string): string {
  if (noteDir.includes('..') || noteDir.includes('/') || noteDir.includes('\\')) {
    throw new Error(`非法笔记目录: ${noteDir}`)
  }
  return join(repoPath(workspacePath, repoName), 'notes', noteDir, 'README.md')
}

function listKnowledgeDirs(
  workspacePath: string,
  options?: { includeBlacklisted?: boolean }
): string[] {
  const blacklist = new Set(loadSettings().blacklist)
  return readdirSync(workspacePath)
    .filter((name) => TN_DIR.test(name))
    .filter((name) => {
      try {
        return statSync(join(workspacePath, name)).isDirectory()
      } catch {
        return false
      }
    })
    .filter((name) => options?.includeBlacklisted || !blacklist.has(name))
    .sort((a, b) => a.localeCompare(b))
}

function withRepo<T>(repoName: string, fn: (root: string) => T): T {
  const { path } = loadWorkspace()
  const workspacePath = assertWorkspace(path)
  return fn(repoPath(workspacePath, repoName))
}

export function registerIpc(): void {
  ipcMain.handle('workspace:get', () => loadWorkspace())

  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return loadWorkspace()
    }
    return saveWorkspace(result.filePaths[0])
  })

  ipcMain.handle('workspace:set', (_event, path: string | null) => {
    if (path !== null && !existsSync(path)) {
      throw new Error(`路径不存在: ${path}`)
    }
    return saveWorkspace(path)
  })

  ipcMain.handle('settings:get', () => loadSettings())

  ipcMain.handle('settings:set', (_event, next: { blacklist?: string[] }) => {
    return saveSettings(next)
  })

  ipcMain.handle('knowledge:list', () => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    return listKnowledgeDirs(workspacePath)
  })

  ipcMain.handle('knowledge:scan', () => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    return listKnowledgeDirs(workspacePath, { includeBlacklisted: true })
  })

  ipcMain.handle('toc:read', (_event, repoName: string): DeskTocNode[] =>
    withRepo(repoName, (root) => readDeskToc(root))
  )

  ipcMain.handle(
    'toc:create-notes',
    async (
      _event,
      repoName: string,
      options: {
        count?: number
        title?: string
        parentTocLineIndex?: number
        aroundNoteIndex?: string
        placement?: 'before' | 'after'
      }
    ) => withRepo(repoName, (root) => createNotes(root, options))
  )

  ipcMain.handle(
    'toc:create-folder',
    async (_event, repoName: string, options: { title: string; parentTocLineIndex?: number }) =>
      withRepo(repoName, (root) => createFolder(root, options))
  )

  ipcMain.handle(
    'toc:rename-note',
    async (_event, repoName: string, noteIndex: string, newTitle: string) =>
      withRepo(repoName, (root) => renameNote(root, noteIndex, newTitle))
  )

  ipcMain.handle(
    'toc:rename-folder',
    async (_event, repoName: string, tocLineIndex: number, newTitle: string) =>
      withRepo(repoName, (root) => renameFolder(root, tocLineIndex, newTitle))
  )

  ipcMain.handle('toc:delete-note', async (_event, repoName: string, noteIndex: string) =>
    withRepo(repoName, (root) => deleteNote(root, noteIndex))
  )

  ipcMain.handle('toc:delete-entry', async (_event, repoName: string, tocLineIndex: number) =>
    withRepo(repoName, (root) => deleteEntry(root, tocLineIndex))
  )

  ipcMain.handle(
    'toc:reorder',
    async (
      _event,
      repoName: string,
      payload: { nodeId: string; action: 'moveAfter' | 'prependChild'; targetNodeId?: string }
    ) => withRepo(repoName, (root) => reorderByNodeId(root, payload))
  )

  ipcMain.handle('note:read', (_event, repoName: string, noteDir: string) => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    const file = noteReadmePath(workspacePath, repoName, noteDir)
    if (!existsSync(file)) {
      throw new Error(`README.md 不存在: ${repoName}/notes/${noteDir}`)
    }
    return {
      path: file,
      content: readFileSync(file, 'utf-8')
    }
  })

  ipcMain.handle('note:write', (_event, repoName: string, noteDir: string, content: string) => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    const file = noteReadmePath(workspacePath, repoName, noteDir)
    if (!existsSync(join(repoPath(workspacePath, repoName), 'notes', noteDir))) {
      throw new Error(`笔记目录不存在: ${repoName}/notes/${noteDir}`)
    }
    writeFileSync(file, content, 'utf-8')
    return { path: file, ok: true }
  })

  ipcMain.handle('git:status', async (_event, repoName: string): Promise<GitStatus> => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    return getGitStatus(repoName, repoPath(workspacePath, repoName))
  })

  ipcMain.handle('git:status-all', async (): Promise<GitStatus[]> => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    const repos = listKnowledgeDirs(workspacePath)
    const results: GitStatus[] = []
    for (const repo of repos) {
      results.push(await getGitStatus(repo, repoPath(workspacePath, repo)))
    }
    return results
  })

  ipcMain.handle('git:pull', async (_event, repoName: string) => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    const dir = repoPath(workspacePath, repoName)
    const result = await gitPull(dir)
    const status = await getGitStatus(repoName, dir)
    return { ...result, status }
  })

  ipcMain.handle('git:push', async (_event, repoName: string) => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    const dir = repoPath(workspacePath, repoName)
    deskLog('git:ipc', 'push invoked', { repoName, dir, workspacePath })
    const result = await gitPush(dir)
    const status = await getGitStatus(repoName, dir)
    deskLog('git:ipc', 'push result', {
      ok: result.ok,
      error: result.error,
      stdout: result.stdout.slice(0, 500),
      stderr: result.stderr.slice(0, 500),
      status
    })
    return { ...result, status }
  })

  ipcMain.handle('preview:status', () => previewManager.getState())

  ipcMain.handle('preview:start', async (_event, repoName: string) => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    return previewManager.ensureStarted(repoName, repoPath(workspacePath, repoName))
  })

  ipcMain.handle('preview:stop', async () => previewManager.stop())

  ipcMain.handle('preview:note-url', (_event, repoName: string, noteDir: string) => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    const file = noteReadmePath(workspacePath, repoName, noteDir)
    if (!existsSync(file)) {
      throw new Error(`README.md 不存在: ${repoName}/notes/${noteDir}`)
    }
    const port = previewManager.getState().port
    if (!port || previewManager.getState().repo !== repoName) {
      let fallbackPort = 5173
      try {
        const raw = readFileSync(join(repoPath(workspacePath, repoName), '.tnotes.json'), 'utf-8')
        const data = JSON.parse(raw) as { port?: number }
        if (typeof data.port === 'number' && data.port > 0) fallbackPort = data.port
      } catch {
        // ignore
      }
      return buildNotePreviewUrl(repoName, fallbackPort, noteDir)
    }
    return buildNotePreviewUrl(repoName, port, noteDir)
  })
}
