import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'

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
}

async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = 120_000
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  })
  return {
    stdout: stdout.toString(),
    stderr: stderr.toString()
  }
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

    const { stdout: porcelain } = await runGit(repoDir, ['status', '--porcelain'])
    const lines = porcelain.split(/\r?\n/).filter((line) => line.trim().length > 0)
    base.changed = lines.length
    base.clean = lines.length === 0

    try {
      const { stdout } = await runGit(repoDir, [
        'rev-list',
        '--left-right',
        '--count',
        '@{upstream}...HEAD'
      ])
      const [behindRaw, aheadRaw] = stdout.trim().split(/\s+/)
      base.behind = Number(behindRaw) || 0
      base.ahead = Number(aheadRaw) || 0
    } catch {
      // no upstream configured
      base.behind = 0
      base.ahead = 0
    }

    return base
  } catch (e) {
    return {
      ...base,
      isRepo: true,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

export async function gitPull(repoDir: string): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await runGit(repoDir, ['pull', '--ff-only'], 180_000)
    return { ok: true, stdout, stderr, error: null }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      error: err.stderr?.toString() || err.message || String(e)
    }
  }
}

export async function gitPush(repoDir: string): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await runGit(repoDir, ['push'], 180_000)
    return { ok: true, stdout, stderr, error: null }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      error: err.stderr?.toString() || err.message || String(e)
    }
  }
}
