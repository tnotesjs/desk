import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { deskLog } from './log'
import { loadSettings } from './settings'

import type { PreviewStartResult, PreviewStateDto } from '../shared/contracts'

const DEFAULT_PORT = 5173
const READY_TIMEOUT_MS = 90_000
const OUTPUT_TAIL_MAX = 4000

interface PreviewHandle {
  state: PreviewStateDto
  child: ChildProcess | null
  readyPromise: Promise<void> | null
  outputTail: string
  stopping: boolean
}

function readRepoPort(repoDir: string): number {
  try {
    const raw = fs.readFileSync(path.join(repoDir, '.tnotes.json'), 'utf8')
    const data = JSON.parse(raw) as { port?: number }
    if (typeof data.port === 'number' && data.port > 0 && data.port < 65536) return data.port
  } catch {
    // Use the conventional Vite port.
  }
  return DEFAULT_PORT
}

function resolveNvmAlias(nvmDir: string, name: string): string {
  let current = name
  for (let index = 0; index < 8; index += 1) {
    const aliasPath = path.join(nvmDir, 'alias', current)
    if (!fs.existsSync(aliasPath)) break
    try {
      current = fs.readFileSync(aliasPath, 'utf8').trim()
    } catch {
      break
    }
  }
  return current
}

function resolveNvmBin(): string | null {
  if (process.env.NVM_BIN && fs.existsSync(path.join(process.env.NVM_BIN, 'node'))) {
    return process.env.NVM_BIN
  }
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm')
  const versionsRoot = path.join(nvmDir, 'versions', 'node')
  if (!fs.existsSync(versionsRoot)) return null
  const aliasTarget = resolveNvmAlias(nvmDir, 'default')
  const candidates = [
    path.join(versionsRoot, aliasTarget, 'bin'),
    path.join(versionsRoot, aliasTarget.startsWith('v') ? aliasTarget : `v${aliasTarget}`, 'bin')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'node'))) return candidate
  }
  const versions = fs
    .readdirSync(versionsRoot)
    .filter((version) => /^v\d+\.\d+\.\d+/.test(version))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  const latest = versions.at(-1)
  return latest ? path.join(versionsRoot, latest, 'bin') : null
}

function previewEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_NO_ASAR
  const configuredNode = loadSettings().nodePath
  const configuredNodeBin =
    configuredNode && path.isAbsolute(configuredNode)
      ? fs.existsSync(configuredNode) && fs.statSync(configuredNode).isDirectory()
        ? configuredNode
        : path.dirname(configuredNode)
      : null
  const additionalPaths = [
    configuredNodeBin,
    resolveNvmBin(),
    path.join(os.homedir(), '.local', 'share', 'pnpm'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ].filter((entry): entry is string => Boolean(entry))
  environment.PATH = [...additionalPaths, environment.PATH ?? ''].join(path.delimiter)
  environment.GIT_TERMINAL_PROMPT = '0'
  return environment
}

function packageManager(repoDir: string): { command: string; args: string[] } {
  if (fs.existsSync(path.join(repoDir, 'pnpm-lock.yaml'))) {
    return { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args: ['tn:dev'] }
  }
  if (fs.existsSync(path.join(repoDir, 'yarn.lock'))) {
    return { command: process.platform === 'win32' ? 'yarn.cmd' : 'yarn', args: ['tn:dev'] }
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'tn:dev']
  }
}

function notePreviewUrl(baseUrl: string, repoName: string, noteDirName?: string): string {
  if (!noteDirName) return baseUrl
  const base = new URL(baseUrl)
  base.pathname = `/${repoName}/notes/${encodeURIComponent(noteDirName)}/README`
  return base.toString()
}

export class PreviewManager {
  private handles = new Map<string, PreviewHandle>()
  private listener: ((state: PreviewStateDto) => void) | null = null

  onChanged(listener: (state: PreviewStateDto) => void): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  list(): PreviewStateDto[] {
    return [...this.handles.values()].map((handle) => ({ ...handle.state }))
  }

  async start(
    knowledgeBaseId: string,
    knowledgeBaseName: string,
    repoDir: string,
    noteDirName?: string
  ): Promise<PreviewStartResult> {
    const existing = this.handles.get(knowledgeBaseId)
    if (existing?.child && !existing.child.killed) {
      if (existing.state.status === 'starting' && existing.readyPromise) {
        await existing.readyPromise.catch(() => undefined)
      }
      return {
        state: { ...existing.state },
        url: existing.state.baseUrl
          ? notePreviewUrl(existing.state.baseUrl, knowledgeBaseName, noteDirName)
          : null
      }
    }

    if (!fs.existsSync(path.join(repoDir, 'package.json'))) {
      const state: PreviewStateDto = {
        knowledgeBaseId,
        knowledgeBaseName,
        status: 'error',
        port: null,
        baseUrl: null,
        error: '知识库缺少 package.json，无法启动站点预览'
      }
      this.handles.set(knowledgeBaseId, {
        state,
        child: null,
        readyPromise: null,
        outputTail: '',
        stopping: false
      })
      this.emit(state)
      return { state, url: null }
    }

    const hasInstalledDependencies =
      fs.existsSync(path.join(repoDir, 'node_modules')) ||
      fs.existsSync(path.join(repoDir, '.pnp.cjs')) ||
      fs.existsSync(path.join(repoDir, '.pnp.js'))
    if (!hasInstalledDependencies) {
      const state: PreviewStateDto = {
        knowledgeBaseId,
        knowledgeBaseName,
        status: 'error',
        port: null,
        baseUrl: null,
        error: '知识库依赖尚未安装。请先在配置的 IDE 或终端中为该知识库安装依赖。'
      }
      this.handles.set(knowledgeBaseId, {
        state,
        child: null,
        readyPromise: null,
        outputTail: '',
        stopping: false
      })
      this.emit(state)
      return { state, url: null }
    }

    const port = readRepoPort(repoDir)
    const state: PreviewStateDto = {
      knowledgeBaseId,
      knowledgeBaseName,
      status: 'starting',
      port,
      baseUrl: `http://localhost:${port}/${knowledgeBaseName}/`,
      error: null
    }
    const handle: PreviewHandle = {
      state,
      child: null,
      readyPromise: null,
      outputTail: '',
      stopping: false
    }
    this.handles.set(knowledgeBaseId, handle)
    this.emit(state)

    handle.readyPromise = this.spawnAndWait(handle, repoDir)
    await handle.readyPromise.catch(() => undefined)
    handle.readyPromise = null
    return {
      state: { ...handle.state },
      url: handle.state.baseUrl
        ? notePreviewUrl(handle.state.baseUrl, knowledgeBaseName, noteDirName)
        : null
    }
  }

  async stop(knowledgeBaseId: string): Promise<PreviewStateDto> {
    const handle = this.handles.get(knowledgeBaseId)
    if (!handle) {
      return {
        knowledgeBaseId,
        knowledgeBaseName: knowledgeBaseId,
        status: 'idle',
        port: null,
        baseUrl: null,
        error: null
      }
    }
    await this.stopHandle(handle)
    this.handles.delete(knowledgeBaseId)
    const state: PreviewStateDto = { ...handle.state, status: 'idle', error: null }
    this.emit(state)
    return state
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.handles.values()].map((handle) => this.stopHandle(handle)))
    this.handles.clear()
  }

  private spawnAndWait(handle: PreviewHandle, repoDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const runtime = packageManager(repoDir)
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => {
        if (handle.state.status === 'starting') {
          handle.state = { ...handle.state, status: 'ready' }
          this.emit(handle.state)
        }
        finish()
      }, READY_TIMEOUT_MS)

      const child = spawn(runtime.command, runtime.args, {
        cwd: repoDir,
        env: previewEnvironment(),
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      handle.child = child
      deskLog('preview', 'started', {
        knowledgeBaseId: handle.state.knowledgeBaseId,
        command: runtime.command,
        pid: child.pid ?? null
      })

      const onOutput = (chunk: Buffer | string): void => {
        const text = chunk.toString()
        handle.outputTail = `${handle.outputTail}${text}`.slice(-OUTPUT_TAIL_MAX)
        const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/[^\s]*)?/i)
        if (match && handle.state.status === 'starting') {
          const detectedPort = Number(match[1])
          handle.state = {
            ...handle.state,
            status: 'ready',
            port: detectedPort,
            baseUrl: `http://localhost:${detectedPort}/${handle.state.knowledgeBaseName}/`,
            error: null
          }
          this.emit(handle.state)
          finish()
        }
      }
      child.stdout?.on('data', onOutput)
      child.stderr?.on('data', onOutput)
      child.on('error', (error) => {
        if (handle.stopping) return finish()
        handle.child = null
        handle.state = { ...handle.state, status: 'error', error: error.message }
        this.emit(handle.state)
        finish(error)
      })
      child.on('exit', (code, signal) => {
        if (handle.child === child) handle.child = null
        if (handle.stopping) return finish()
        const summary = `预览进程已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`
        handle.state = {
          ...handle.state,
          status: 'error',
          error: handle.outputTail.trim() ? `${summary}\n\n${handle.outputTail.trim()}` : summary
        }
        this.emit(handle.state)
        finish(new Error(summary))
      })
    })
  }

  private async stopHandle(handle: PreviewHandle): Promise<void> {
    handle.stopping = true
    const child = handle.child
    handle.child = null
    if (!child?.pid || child.killed) return
    const pid = child.pid
    await new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        resolve()
      }
      child.once('exit', finish)
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true })
        } else {
          process.kill(-pid, 'SIGTERM')
        }
      } catch {
        child.kill('SIGTERM')
      }
      setTimeout(() => {
        try {
          if (process.platform === 'win32') child.kill('SIGKILL')
          else process.kill(-pid, 'SIGKILL')
        } catch {
          // Process already exited.
        }
        finish()
      }, 2500)
    })
  }

  private emit(state: PreviewStateDto): void {
    this.listener?.({ ...state })
  }
}

export const previewManager = new PreviewManager()
