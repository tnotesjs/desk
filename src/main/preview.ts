import { ChildProcess, spawn } from 'child_process'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { deskLog } from './log'

export type PreviewRuntimeStatus = 'idle' | 'starting' | 'ready' | 'error'

export interface PreviewState {
  repo: string | null
  port: number | null
  status: PreviewRuntimeStatus
  error: string | null
  baseUrl: string | null
}

const DEFAULT_PORT = 5173
const READY_TIMEOUT_MS = 90_000
const OUTPUT_TAIL_MAX = 4000

function readRepoPort(repoDir: string): number {
  try {
    const raw = readFileSync(join(repoDir, '.tnotes.json'), 'utf-8')
    const data = JSON.parse(raw) as { port?: number }
    if (typeof data.port === 'number' && data.port > 0) return data.port
  } catch {
    // fall through
  }
  return DEFAULT_PORT
}

export function buildNotePreviewUrl(repoName: string, port: number, noteDir: string): string {
  const folder = encodeURIComponent(noteDir)
  return `http://localhost:${port}/${repoName}/notes/${folder}/README`
}

function resolveNvmAlias(nvmDir: string, name: string): string {
  let current = name
  for (let i = 0; i < 8; i++) {
    const aliasPath = join(nvmDir, 'alias', current)
    if (!existsSync(aliasPath)) break
    try {
      current = readFileSync(aliasPath, 'utf-8').trim()
    } catch {
      break
    }
  }
  return current
}

function resolveNvmBin(): string | null {
  if (process.env.NVM_BIN && existsSync(join(process.env.NVM_BIN, 'node'))) {
    return process.env.NVM_BIN
  }

  const nvmDir = process.env.NVM_DIR || join(homedir(), '.nvm')
  const versionsRoot = join(nvmDir, 'versions', 'node')
  if (!existsSync(versionsRoot)) return null

  const aliasTarget = resolveNvmAlias(nvmDir, 'default')
  const candidates = [
    join(versionsRoot, aliasTarget, 'bin'),
    join(versionsRoot, aliasTarget.startsWith('v') ? aliasTarget : `v${aliasTarget}`, 'bin')
  ]

  for (const bin of candidates) {
    if (existsSync(join(bin, 'node'))) return bin
  }

  const versions = readdirSync(versionsRoot)
    .filter((v) => /^v\d+\.\d+\.\d+/.test(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const latest = versions[versions.length - 1]
  if (!latest) return null
  const latestBin = join(versionsRoot, latest, 'bin')
  return existsSync(join(latestBin, 'node')) ? latestBin : null
}

function buildPreviewEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ASAR

  const prepend: string[] = []
  const nvmBin = resolveNvmBin()
  if (nvmBin) prepend.push(nvmBin)
  prepend.push(join(homedir(), '.local', 'share', 'pnpm'))
  prepend.push('/opt/homebrew/bin', '/usr/local/bin')

  const path = env.PATH || ''
  env.PATH = [...prepend, path].filter(Boolean).join(':')

  deskLog('preview:env', 'nvmBin', nvmBin)
  deskLog('preview:env', 'PATH head', env.PATH.split(':').slice(0, 8))
  deskLog('preview:env', 'ELECTRON_RUN_AS_NODE', process.env.ELECTRON_RUN_AS_NODE ?? '(unset)')

  return env
}

function isReadyOutput(text: string): boolean {
  return (
    text.includes('Local:') ||
    text.includes('http://localhost') ||
    text.includes('本地开发服务地址') ||
    text.includes('VitePress 服务') ||
    (text.includes('➜') && text.includes('Local'))
  )
}

function spawnDevServer(repoDir: string): ChildProcess {
  const env = buildPreviewEnv()

  if (process.platform === 'win32') {
    return spawn('pnpm.cmd', ['tn:dev'], {
      cwd: repoDir,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }

  // Non-login shell: keep our PATH (login shells reset to system Node and break pnpm).
  return spawn('/bin/zsh', ['-c', 'pnpm tn:dev'], {
    cwd: repoDir,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function trimOutputTail(buf: string): string {
  const text = buf.trim()
  if (text.length <= OUTPUT_TAIL_MAX) return text
  return text.slice(-OUTPUT_TAIL_MAX)
}

export class PreviewManager {
  private child: ChildProcess | null = null
  private state: PreviewState = {
    repo: null,
    port: null,
    status: 'idle',
    error: null,
    baseUrl: null
  }
  private readyPromise: Promise<void> | null = null
  private stopping = false
  private outputBuf = ''

  getState(): PreviewState {
    return { ...this.state }
  }

  async ensureStarted(repoName: string, repoDir: string): Promise<PreviewState> {
    deskLog('preview', 'ensureStarted', { repoName, repoDir, current: this.state })

    if (
      this.state.repo === repoName &&
      this.child &&
      !this.child.killed &&
      (this.state.status === 'ready' || this.state.status === 'starting')
    ) {
      deskLog('preview', 'reuse existing process', this.state.status)
      if (this.state.status === 'starting' && this.readyPromise) {
        await this.readyPromise
      }
      return this.getState()
    }

    await this.stop()
    this.stopping = false
    this.outputBuf = ''

    if (!existsSync(join(repoDir, 'package.json'))) {
      this.state = {
        repo: repoName,
        port: null,
        status: 'error',
        error: `缺少 package.json: ${repoName}`,
        baseUrl: null
      }
      deskLog('preview', 'missing package.json', repoDir)
      return this.getState()
    }

    const port = readRepoPort(repoDir)
    this.state = {
      repo: repoName,
      port,
      status: 'starting',
      error: null,
      baseUrl: `http://localhost:${port}/${repoName}/`
    }
    deskLog('preview', 'spawning tn:dev', { port, baseUrl: this.state.baseUrl })

    this.readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (err?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) reject(err)
        else resolve()
      }

      const timer = setTimeout(() => {
        if (this.state.status === 'starting') {
          deskLog('preview', 'ready timeout → soft-ready')
          // Soft-ready: some VitePress logs may not match detectors; iframe can still load.
          this.state = { ...this.state, status: 'ready' }
        }
        finish()
      }, READY_TIMEOUT_MS)

      const onData = (chunk: Buffer | string): void => {
        const text = chunk.toString()
        this.outputBuf += text
        if (this.outputBuf.length > OUTPUT_TAIL_MAX * 2) {
          this.outputBuf = this.outputBuf.slice(-OUTPUT_TAIL_MAX)
        }
        const line = text.trim()
        if (line) deskLog('preview:out', line.slice(0, 500))
        if (isReadyOutput(text)) {
          deskLog('preview', 'ready detected')
          this.state = { ...this.state, status: 'ready', error: null }
          finish()
        }
      }

      const child = spawnDevServer(repoDir)
      this.child = child
      deskLog('preview', 'child pid', child.pid ?? null)

      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)

      child.on('error', (err) => {
        deskLog('preview', 'child error', err.message)
        if (this.stopping) {
          finish()
          return
        }
        this.state = {
          repo: repoName,
          port,
          status: 'error',
          error: err.message,
          baseUrl: null
        }
        this.child = null
        finish(err)
      })

      child.on('exit', (code, signal) => {
        deskLog('preview', 'child exit', { code, signal, stopping: this.stopping })
        if (this.child === child) this.child = null
        if (this.stopping) {
          if (!settled) finish()
          return
        }
        if (this.state.status === 'starting' || this.state.status === 'ready') {
          const tail = trimOutputTail(this.outputBuf)
          const summary = `预览进程已退出 (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
          this.state = {
            repo: repoName,
            port,
            status: 'error',
            error: tail ? `${summary}\n\n${tail}` : summary,
            baseUrl: this.state.baseUrl
          }
        }
        if (!settled) {
          finish(new Error(this.state.error || '预览进程退出'))
        }
      })
    })

    try {
      await this.readyPromise
    } catch {
      // state already recorded
    } finally {
      this.readyPromise = null
    }

    deskLog('preview', 'ensureStarted done', this.getState())
    return this.getState()
  }

  async stop(): Promise<PreviewState> {
    deskLog('preview', 'stop', { hadChild: Boolean(this.child), state: this.state })
    this.stopping = true
    const child = this.child
    this.child = null
    this.readyPromise = null

    const pid = child?.pid
    if (child && pid && !child.killed) {
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
            spawn('taskkill', ['/pid', String(pid), '/f', '/t'])
          } else {
            try {
              process.kill(-pid, 'SIGTERM')
            } catch {
              child.kill('SIGTERM')
            }
          }
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            if (process.platform !== 'win32') {
              process.kill(-pid, 'SIGKILL')
            } else {
              child.kill('SIGKILL')
            }
          } catch {
            // ignore
          }
          finish()
        }, 2500)
      })
    }

    this.state = {
      repo: null,
      port: null,
      status: 'idle',
      error: null,
      baseUrl: null
    }
    this.outputBuf = ''
    return this.getState()
  }
}

export const previewManager = new PreviewManager()
