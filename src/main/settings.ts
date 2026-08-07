import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface AppSettings {
  /** Knowledge base directory names excluded from the sidebar list. */
  blacklist: string[]
}

const DEFAULT_SETTINGS: AppSettings = {
  blacklist: []
}

function settingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'settings.json')
}

function normalize(settings: Partial<AppSettings> | null | undefined): AppSettings {
  const blacklist = Array.isArray(settings?.blacklist)
    ? [...new Set(settings.blacklist.filter((item) => typeof item === 'string' && item.trim()))]
        .map((item) => item.trim())
        .sort((a, b) => a.localeCompare(b))
    : []
  return { blacklist }
}

export function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    return normalize(JSON.parse(raw) as Partial<AppSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(next: Partial<AppSettings>): AppSettings {
  const merged = normalize({
    ...loadSettings(),
    ...next
  })
  writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}
