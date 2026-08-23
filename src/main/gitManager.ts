import { EventEmitter } from 'node:events'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { deskLog } from './log'
import { loadSettings, settingsForKnowledgeBase } from './settings'

import type { GitRepositoryDescriptor } from './workspaceManager'
import type {
  GitFileChangeDto,
  GitFileStatus,
  GitOperationResult,
  GitRepositoryStateDto
} from '../shared/contracts'

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface GitManagerEvents {
  changed: [GitRepositoryStateDto]
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

function gitExecutable(): string {
  return loadSettings().gitPath || 'git'
}

function runGit(rootPath: string, args: string[], timeoutMs = 30_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(gitExecutable(), args, {
      cwd: rootPath,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString('utf8')}`.slice(-2 * 1024 * 1024)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({
        code: 124,
        stdout,
        stderr: `Git 操作超时：git ${args[0]}`
      })
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function commandError(result: CommandResult, fallback: string): Error {
  const message = result.stderr.trim() || result.stdout.trim() || fallback
  return new Error(message)
}

function fileStatus(code: string): GitFileStatus {
  if (CONFLICT_CODES.has(code) || code.includes('U')) return 'conflicted'
  if (code === '??') return 'untracked'
  if (code.includes('R') || code.includes('C')) return 'renamed'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  return 'modified'
}

export function parseGitStatus(output: string): GitFileChangeDto[] {
  const entries = output.split('\0')
  const changes: GitFileChangeDto[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry || entry.length < 3) continue
    const code = entry.slice(0, 2)
    const filePath = entry.slice(3)
    if (!filePath) continue
    let previousPath: string | undefined
    if (code.includes('R') || code.includes('C')) {
      previousPath = entries[index + 1] || undefined
      index += 1
    }
    changes.push({
      path: filePath.replaceAll('\\', '/'),
      previousPath: previousPath?.replaceAll('\\', '/'),
      status: fileStatus(code),
      staged: code[0] !== ' ' && code[0] !== '?',
      worktree: code[1] !== ' ' && code[1] !== '?'
    })
  }
  return changes
}

function defaultState(repository: GitRepositoryDescriptor): GitRepositoryStateDto {
  return {
    knowledgeBaseId: repository.knowledgeBaseId,
    knowledgeBaseName: repository.knowledgeBaseName,
    initialized: false,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    changes: [],
    conflict: false,
    busy: null,
    lastFetchedAt: null,
    error: null
  }
}

function operationMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^fatal:\s*/i, '').trim()
}

export class GitManager {
  private readonly events = new EventEmitter<GitManagerEvents>()
  private repositories = new Map<string, GitRepositoryDescriptor>()
  private states = new Map<string, GitRepositoryStateDto>()
  private operationTails = new Map<string, Promise<void>>()
  private autoPushTimers = new Map<string, NodeJS.Timeout>()
  private periodicFetchTimer: NodeJS.Timeout | null = null

  onChanged(listener: (state: GitRepositoryStateDto) => void): () => void {
    this.events.on('changed', listener)
    return () => this.events.off('changed', listener)
  }

  configure(repositories: GitRepositoryDescriptor[]): void {
    const next = new Map(repositories.map((repository) => [repository.knowledgeBaseId, repository]))
    this.repositories = next
    for (const key of [...this.states.keys()]) {
      if (!next.has(key)) this.states.delete(key)
    }
    for (const repository of repositories) {
      if (!this.states.has(repository.knowledgeBaseId)) {
        this.states.set(repository.knowledgeBaseId, defaultState(repository))
      }
    }
    void this.refresh().then(() => {
      for (const repository of repositories) {
        const state = this.states.get(repository.knowledgeBaseId)
        if (state?.initialized && !state.lastFetchedAt) {
          void this.fetch(repository.knowledgeBaseId, true).catch(() => undefined)
        }
      }
      this.applyAutoPushSchedules(true)
    })
    if (!this.periodicFetchTimer) {
      this.periodicFetchTimer = setInterval(() => {
        for (const state of this.states.values()) {
          if (state.initialized && !state.busy) {
            void this.fetch(state.knowledgeBaseId, true).catch(() => undefined)
          }
        }
      }, 5 * 60_000)
    }
  }

  list(): GitRepositoryStateDto[] {
    return [...this.states.values()].sort((left, right) =>
      left.knowledgeBaseName.localeCompare(right.knowledgeBaseName)
    )
  }

  async refresh(knowledgeBaseId?: string): Promise<GitRepositoryStateDto[]> {
    const targets = knowledgeBaseId
      ? [this.getRepository(knowledgeBaseId)]
      : [...this.repositories.values()]
    await Promise.all(targets.map((repository) => this.refreshRepository(repository)))
    return this.list()
  }

  fetch(knowledgeBaseId: string, background = false): Promise<GitOperationResult> {
    return this.enqueue(knowledgeBaseId, async (repository) => {
      if (!background) this.setBusy(knowledgeBaseId, 'fetch')
      const result = await runGit(
        repository.rootPath,
        ['fetch', '--prune'],
        background ? 15_000 : 60_000
      )
      if (result.code !== 0) {
        const message = operationMessage(commandError(result, 'Git fetch 失败'))
        if (!background) {
          await this.refreshRepository(repository, message)
          throw new Error(message)
        }
        deskLog('git:fetch', 'background fetch failed', {
          knowledgeBaseId,
          message
        })
        const state = await this.refreshRepository(repository)
        return {
          state,
          message,
          conflict: false
        }
      }
      const state = await this.refreshRepository(repository, null, new Date().toISOString())
      return { state, message: '已获取远端最新状态', conflict: false }
    })
  }

  pull(knowledgeBaseId: string): Promise<GitOperationResult> {
    return this.enqueue(knowledgeBaseId, async (repository) => {
      this.setBusy(knowledgeBaseId, 'pull')
      const fetchResult = await runGit(repository.rootPath, ['fetch', '--prune'], 60_000)
      if (fetchResult.code !== 0) throw commandError(fetchResult, '无法获取远端状态')
      const before = await this.readState(repository, new Date().toISOString())
      if (before.conflict || (before.behind > 0 && before.changes.length > 0)) {
        const state = this.storeState({
          ...before,
          busy: null,
          error: '本地存在未提交变更，无法安全快进；请在 IDE 中处理后重试'
        })
        return { state, message: state.error!, conflict: true }
      }
      const result = await runGit(repository.rootPath, ['pull', '--ff-only'], 90_000)
      if (result.code !== 0) {
        const message = operationMessage(commandError(result, 'Git pull 失败'))
        const state = await this.refreshRepository(repository, message)
        return { state, message, conflict: true }
      }
      const state = await this.refreshRepository(repository)
      return { state, message: '已快进到远端最新版本', conflict: false }
    })
  }

  publish(knowledgeBaseId: string): Promise<GitOperationResult> {
    return this.enqueue(knowledgeBaseId, (repository) => this.publishRepository(repository))
  }

  untrackedFilesInside(knowledgeBaseId: string, targets: string[]): string[] {
    const repository = this.getRepository(knowledgeBaseId)
    const normalizedTargets = targets.map((target) => path.resolve(target))
    return this.getState(knowledgeBaseId).changes.flatMap((change) => {
      if (change.status !== 'untracked') return []
      const absolutePath = path.resolve(repository.rootPath, change.path)
      const inside = normalizedTargets.some(
        (target) => absolutePath === target || absolutePath.startsWith(`${target}${path.sep}`)
      )
      return inside ? [absolutePath] : []
    })
  }

  applyAutoPushSchedules(reset = false): void {
    const settings = loadSettings()
    for (const repository of this.repositories.values()) {
      const override = settingsForKnowledgeBase(settings, repository.configId).autoPush
      const existing = this.autoPushTimers.get(repository.knowledgeBaseId)
      if (existing && (reset || !override?.enabled)) {
        clearTimeout(existing)
        this.autoPushTimers.delete(repository.knowledgeBaseId)
      }
      const state = this.states.get(repository.knowledgeBaseId)
      if (!override?.enabled || !state?.changes.length || state.conflict || state.behind > 0)
        continue
      if (this.autoPushTimers.has(repository.knowledgeBaseId)) continue
      this.autoPushTimers.set(
        repository.knowledgeBaseId,
        setTimeout(() => {
          this.autoPushTimers.delete(repository.knowledgeBaseId)
          void this.publish(repository.knowledgeBaseId).catch((error) =>
            deskLog('git:auto-push', 'failed', operationMessage(error))
          )
        }, override.idleMinutes * 60_000)
      )
    }
  }

  async dispose(): Promise<void> {
    if (this.periodicFetchTimer) clearInterval(this.periodicFetchTimer)
    this.periodicFetchTimer = null
    for (const timer of this.autoPushTimers.values()) clearTimeout(timer)
    this.autoPushTimers.clear()
    await Promise.allSettled(this.operationTails.values())
    this.events.removeAllListeners()
  }

  private async publishRepository(
    repository: GitRepositoryDescriptor
  ): Promise<GitOperationResult> {
    this.setBusy(repository.knowledgeBaseId, 'publish')
    const current = await this.readState(repository)
    if (current.conflict) throw new Error('仓库存在冲突，请先在 IDE 中处理')
    if (current.behind > 0) throw new Error('本地版本落后于远端，请先拉取最新版本')
    const add = await runGit(repository.rootPath, ['add', '-A'])
    if (add.code !== 0) throw commandError(add, 'Git 暂存失败')
    const staged = await runGit(repository.rootPath, ['diff', '--cached', '--quiet'])
    let committed = false
    if (staged.code === 1) {
      const timestamp = new Intl.DateTimeFormat('sv-SE', {
        dateStyle: 'short',
        timeStyle: 'short',
        hour12: false
      }).format(new Date())
      const commit = await runGit(
        repository.rootPath,
        ['commit', '-m', `docs: update notes ${timestamp}`],
        120_000
      )
      if (commit.code !== 0) throw commandError(commit, 'Git commit 失败')
      committed = true
    } else if (staged.code !== 0) {
      throw commandError(staged, '无法检查待提交变更')
    }
    const stateBeforePush = await this.readState(repository)
    if (!stateBeforePush.upstream) throw new Error('当前分支没有配置上游仓库，Desk 未执行 push')
    if (!committed && stateBeforePush.ahead === 0) {
      const state = this.storeState({ ...stateBeforePush, busy: null, error: null })
      return { state, message: '没有需要提交或推送的变更', conflict: false }
    }
    const push = await runGit(repository.rootPath, ['push'], 120_000)
    if (push.code !== 0) throw commandError(push, 'Git push 失败')
    const state = await this.refreshRepository(repository)
    return { state, message: '变更已提交并推送到远端', conflict: false }
  }

  private async refreshRepository(
    repository: GitRepositoryDescriptor,
    error: string | null = null,
    lastFetchedAt?: string
  ): Promise<GitRepositoryStateDto> {
    try {
      const state = await this.readState(repository, lastFetchedAt)
      return this.storeState({ ...state, busy: null, error })
    } catch (cause) {
      const previous = this.states.get(repository.knowledgeBaseId) ?? defaultState(repository)
      return this.storeState({
        ...previous,
        busy: null,
        error: error ?? operationMessage(cause)
      })
    }
  }

  private async readState(
    repository: GitRepositoryDescriptor,
    lastFetchedAt?: string
  ): Promise<GitRepositoryStateDto> {
    const inside = await runGit(repository.rootPath, ['rev-parse', '--is-inside-work-tree'])
    if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
      return { ...defaultState(repository), error: '目录不是 Git 仓库' }
    }
    const [statusResult, branchResult, upstreamResult] = await Promise.all([
      runGit(repository.rootPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      runGit(repository.rootPath, ['branch', '--show-current']),
      runGit(repository.rootPath, [
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{upstream}'
      ])
    ])
    if (statusResult.code !== 0) throw commandError(statusResult, 'Git status 失败')
    const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.trim() || null : null
    let ahead = 0
    let behind = 0
    if (upstream) {
      const counts = await runGit(repository.rootPath, [
        'rev-list',
        '--left-right',
        '--count',
        `HEAD...${upstream}`
      ])
      if (counts.code === 0) {
        const [left, right] = counts.stdout.trim().split(/\s+/).map(Number)
        ahead = Number.isFinite(left) ? left : 0
        behind = Number.isFinite(right) ? right : 0
      }
    }
    const changes = parseGitStatus(statusResult.stdout)
      .map((change) => this.attachNote(repository, change))
      .sort((left, right) =>
        `${left.noteIndex ?? 'zzzz'}:${left.path}`.localeCompare(
          `${right.noteIndex ?? 'zzzz'}:${right.path}`
        )
      )
    const previous = this.states.get(repository.knowledgeBaseId)
    return {
      knowledgeBaseId: repository.knowledgeBaseId,
      knowledgeBaseName: repository.knowledgeBaseName,
      initialized: true,
      branch: branchResult.code === 0 ? branchResult.stdout.trim() || null : null,
      upstream,
      ahead,
      behind,
      changes,
      conflict: changes.some((change) => change.status === 'conflicted'),
      busy: previous?.busy ?? null,
      lastFetchedAt: lastFetchedAt ?? previous?.lastFetchedAt ?? null,
      error: null
    }
  }

  private attachNote(
    repository: GitRepositoryDescriptor,
    change: GitFileChangeDto
  ): GitFileChangeDto {
    const relative = change.path.replaceAll('\\', '/')
    const note = repository.notes.find((candidate) =>
      relative.startsWith(`notes/${candidate.dirName}/`)
    )
    return note
      ? {
          ...change,
          noteUuid: note.uuid,
          noteIndex: note.index,
          noteTitle: note.title
        }
      : change
  }

  private enqueue(
    knowledgeBaseId: string,
    operation: (repository: GitRepositoryDescriptor) => Promise<GitOperationResult>
  ): Promise<GitOperationResult> {
    const repository = this.getRepository(knowledgeBaseId)
    const previous = this.operationTails.get(knowledgeBaseId) ?? Promise.resolve()
    const result = previous.then(() => operation(repository))
    const tail = result.then(
      () => undefined,
      async (error) => {
        await this.refreshRepository(repository, operationMessage(error))
      }
    )
    this.operationTails.set(knowledgeBaseId, tail)
    const cleanup = (): void => {
      if (this.operationTails.get(knowledgeBaseId) === tail) {
        this.operationTails.delete(knowledgeBaseId)
      }
      this.applyAutoPushSchedules()
    }
    void result.then(cleanup, cleanup)
    return result
  }

  private setBusy(knowledgeBaseId: string, busy: GitRepositoryStateDto['busy']): void {
    const state = this.getState(knowledgeBaseId)
    this.storeState({ ...state, busy, error: null })
  }

  private storeState(state: GitRepositoryStateDto): GitRepositoryStateDto {
    this.states.set(state.knowledgeBaseId, state)
    this.events.emit('changed', state)
    return state
  }

  private getState(knowledgeBaseId: string): GitRepositoryStateDto {
    const state = this.states.get(knowledgeBaseId)
    if (!state) throw new Error(`Git 状态不存在：${knowledgeBaseId}`)
    return state
  }

  private getRepository(knowledgeBaseId: string): GitRepositoryDescriptor {
    const repository = this.repositories.get(knowledgeBaseId)
    if (!repository) throw new Error(`知识库不存在：${knowledgeBaseId}`)
    return repository
  }
}

export const gitManager = new GitManager()
