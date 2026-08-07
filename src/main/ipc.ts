import { dialog, ipcMain } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getGitStatus, gitPull, gitPush, type GitStatus } from './git'
import { loadSettings, saveSettings } from './settings'
import { parseTocMarkdown, type TocNode } from './toc'
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
  if (!TN_DIR.test(repoName) || repoName.includes('..') || repoName.includes('/') || repoName.includes('\\')) {
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

function listKnowledgeDirs(workspacePath: string, options?: { includeBlacklisted?: boolean }): string[] {
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

  ipcMain.handle('toc:read', (_event, repoName: string): TocNode[] => {
    const { path } = loadWorkspace()
    const workspacePath = assertWorkspace(path)
    const tocFile = join(repoPath(workspacePath, repoName), 'TOC.md')
    if (!existsSync(tocFile)) {
      throw new Error(`TOC.md 不存在: ${repoName}`)
    }
    const content = readFileSync(tocFile, 'utf-8')
    return parseTocMarkdown(content)
  })

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
    if (!existsSync(file)) {
      throw new Error(`README.md 不存在: ${repoName}/notes/${noteDir}`)
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
    const concurrency = 6
    for (let i = 0; i < repos.length; i += concurrency) {
      const batch = repos.slice(i, i + concurrency)
      const batchResults = await Promise.all(
        batch.map((name) => getGitStatus(name, join(workspacePath, name)))
      )
      results.push(...batchResults)
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
    const result = await gitPush(dir)
    const status = await getGitStatus(repoName, dir)
    return { ...result, status }
  })
}
