import { app, safeStorage } from 'electron'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

import type { ImageTokenStatus } from '../shared/contracts'

interface StoredSecret {
  version: 1
  githubToken: string
}

function secretPath(): string {
  const directory = app.getPath('userData')
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
  return join(directory, 'secrets.v1.json')
}

function encryptedToken(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(secretPath(), 'utf8')) as Partial<StoredSecret>
    return parsed.version === 1 && typeof parsed.githubToken === 'string'
      ? parsed.githubToken
      : null
  } catch {
    return null
  }
}

export function readGitHubToken(): string | null {
  const encrypted = encryptedToken()
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return null
  }
}

export function imageTokenStatus(): ImageTokenStatus {
  return {
    configured: Boolean(readGitHubToken()),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}

export function saveGitHubToken(token: string): ImageTokenStatus {
  const normalized = token.trim()
  if (!normalized) throw new Error('GitHub Token 不能为空')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法安全加密 GitHub Token，Desk 已拒绝保存明文凭据')
  }
  const target = secretPath()
  const temporary = `${target}.tmp`
  const payload: StoredSecret = {
    version: 1,
    githubToken: safeStorage.encryptString(normalized).toString('base64')
  }
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  chmodSync(temporary, 0o600)
  renameSync(temporary, target)
  return imageTokenStatus()
}

export function clearGitHubToken(): ImageTokenStatus {
  const target = secretPath()
  try {
    unlinkSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return imageTokenStatus()
}
