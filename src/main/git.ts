import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { deskLog } from './log'

const execFileAsync = promisify(execFile)

export interface GitStatus {
  repo: string
  isRepo: boolean
  branch: string | null
  clean: boolean
  changed: number
  ahead: number
  behind: number
  error: string | null
}

export interface GitCommandResult {
  ok: boolean
  stdout: string
  stderr: string
  error: string | null
  /** Human-readable summary for UI (aligned with tn:pull / tn:push). */
  message: string | null
}

async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = 120_000
): Promise<{ stdout: string; stderr: string }> {
  deskLog('git:run', 'exec', { cwd, args, timeoutMs })
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  })
  const out = {
    stdout: stdout.toString(),
    stderr: stderr.toString()
  }
  deskLog('git:run', 'done', {
    cwd,
    args,
    stdout: out.stdout.slice(0, 1000),
    stderr: out.stderr.slice(0, 1000)
  })
  return out
}

function failResult(e: unknown): GitCommandResult {
  const err = e as { stdout?: string; stderr?: string; message?: string }
  const stdout = err.stdout?.toString() ?? ''
  const stderr = err.stderr?.toString() ?? ''
  const error = stderr || err.message || String(e)
  return { ok: false, stdout, stderr, error, message: null }
}

/** Same style as @tnotesjs/core GitService.generateCommitMessage */
export function generateCommitMessage(): string {
  const now = new Date()
  const date = now.toISOString().split('T')[0]
  const time = now.toTimeString().split(' ')[0]
  return `📝 Update notes - ${date} ${time}`
}

async function countAheadBehind(
  repoDir: string
): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout } = await runGit(repoDir, [
      'rev-list',
      '--left-right',
      '--count',
      '@{upstream}...HEAD'
    ])
    const [behindRaw, aheadRaw] = stdout.trim().split(/\s+/)
    return {
      behind: Number(behindRaw) || 0,
      ahead: Number(aheadRaw) || 0
    }
  } catch {
    return { ahead: 0, behind: 0 }
  }
}

async function countChangedFiles(repoDir: string): Promise<number> {
  const { stdout } = await runGit(repoDir, ['status', '--porcelain'])
  return stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

export async function getGitStatus(repoName: string, repoDir: string): Promise<GitStatus> {
  const base: GitStatus = {
    repo: repoName,
    isRepo: false,
    branch: null,
    clean: true,
    changed: 0,
    ahead: 0,
    behind: 0,
    error: null
  }

  if (!existsSync(join(repoDir, '.git'))) {
    return { ...base, error: '不是 git 仓库' }
  }

  try {
    await runGit(repoDir, ['rev-parse', '--is-inside-work-tree'])
    base.isRepo = true

    try {
      const { stdout } = await runGit(repoDir, ['branch', '--show-current'])
      base.branch = stdout.trim() || null
    } catch {
      base.branch = null
    }

    base.changed = await countChangedFiles(repoDir)
    base.clean = base.changed === 0

    const ab = await countAheadBehind(repoDir)
    base.ahead = ab.ahead
    base.behind = ab.behind

    return base
  } catch (e) {
    return {
      ...base,
      isRepo: true,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/**
 * Align with tn:pull → GitManager.pull({ rebase: true, autostash: true })
 */
export async function gitPull(repoDir: string): Promise<GitCommandResult> {
  deskLog('git:pull', 'start (tn-like)', { repoDir })
  try {
    const before = (await runGit(repoDir, ['rev-parse', 'HEAD'])).stdout.trim()
    const { stdout, stderr } = await runGit(
      repoDir,
      ['pull', '--rebase', '--autostash'],
      180_000
    )
    const after = (await runGit(repoDir, ['rev-parse', 'HEAD'])).stdout.trim()
    const message =
      before === after ? '已是最新，没有需要拉取的更新' : '拉取完成'
    deskLog('git:pull', 'ok', { message, before, after })
    return { ok: true, stdout, stderr, error: null, message }
  } catch (e) {
    deskLog('git:pull', 'failed', e instanceof Error ? e.message : String(e))
    return failResult(e)
  }
}

/**
 * Align with tn:push → PushCommand:
 * if dirty: git add -A + commit (auto message) + push
 * else if ahead: git push
 * else: nothing to push
 */
export async function gitPush(repoDir: string): Promise<GitCommandResult> {
  deskLog('git:push', 'start (tn-like)', { repoDir })
  try {
    const changed = await countChangedFiles(repoDir)
    const { ahead } = await countAheadBehind(repoDir)
    deskLog('git:push', 'precheck', { changed, ahead })

    if (changed === 0 && ahead === 0) {
      const message = '没有更改需要推送'
      deskLog('git:push', message)
      return { ok: true, stdout: '', stderr: '', error: null, message }
    }

    const logs: string[] = []

    if (changed > 0) {
      const commitMessage = generateCommitMessage()
      deskLog('git:push', 'commit then push', { changed, commitMessage })
      await runGit(repoDir, ['add', '-A'])
      try {
        const committed = await runGit(repoDir, ['commit', '-m', commitMessage])
        logs.push(committed.stdout.trim(), committed.stderr.trim())
      } catch (e) {
        const err = e as { stderr?: string; message?: string }
        const text = err.stderr?.toString() || err.message || String(e)
        // Race / empty index: continue to push if we still have ahead commits.
        if (!/nothing to commit/i.test(text)) {
          throw e
        }
        logs.push(text)
      }
    } else {
      deskLog('git:push', 'push existing commits', { ahead })
    }

    const pushed = await runGit(repoDir, ['push'], 180_000)
    logs.push(pushed.stdout.trim(), pushed.stderr.trim())
    const combined = logs.filter(Boolean).join('\n')
    const message = '推送完成'
    deskLog('git:push', 'ok', { message, combined: combined.slice(0, 1000) })
    return {
      ok: true,
      stdout: combined,
      stderr: pushed.stderr,
      error: null,
      message
    }
  } catch (e) {
    deskLog('git:push', 'failed', e instanceof Error ? e.message : String(e))
    return failResult(e)
  }
}
