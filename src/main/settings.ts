import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import type { AppSettings, KnowledgeBaseSettings } from '../shared/contracts'

const knowledgeBaseSettingsSchema = z.object({
  hidden: z.boolean().optional(),
  prettier: z.boolean().optional(),
  autoPush: z
    .object({
      enabled: z.boolean(),
      idleMinutes: z.number().int().min(1).max(1440)
    })
    .optional()
})

const settingsSchema = z.object({
  version: z.literal(1).default(1),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  density: z.enum(['compact', 'comfortable']).default('comfortable'),
  defaultNoteView: z.enum(['visual', 'source']).default('visual'),
  autosave: z
    .object({
      enabled: z.boolean().default(true),
      delayMs: z.number().int().min(250).max(30_000).default(1000)
    })
    .default({ enabled: true, delayMs: 1000 }),
  prettier: z.boolean().default(true),
  ide: z.enum(['vscode', 'cursor']).default('vscode'),
  gitPath: z.string().trim().min(1).nullable().default(null),
  nodePath: z.string().trim().min(1).nullable().default(null),
  confirmBeforeCommit: z.boolean().default(false),
  hiddenKnowledgeBases: z.array(z.string().min(1)).default([]),
  knowledgeBases: z.record(z.string(), knowledgeBaseSettingsSchema).default({})
})

const DEFAULT_SETTINGS: AppSettings = settingsSchema.parse({})

function settingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.v1.json')
}

function legacySettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  )
}

function normalizeKnowledgeBaseSettings(
  input: Record<string, KnowledgeBaseSettings>
): Record<string, KnowledgeBaseSettings> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => key.trim())
      .sort(([left], [right]) => left.localeCompare(right))
  )
}

function normalize(input: unknown): AppSettings {
  const parsed = settingsSchema.parse(input)
  return {
    ...parsed,
    hiddenKnowledgeBases: uniqueSorted(parsed.hiddenKnowledgeBases),
    knowledgeBases: normalizeKnowledgeBaseSettings(parsed.knowledgeBases)
  }
}

function readLegacyHiddenNames(): string[] {
  try {
    const legacy = JSON.parse(readFileSync(legacySettingsPath(), 'utf8')) as {
      blacklist?: unknown
    }
    return Array.isArray(legacy.blacklist)
      ? legacy.blacklist.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function loadSettings(): AppSettings {
  try {
    return normalize(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    const legacyHidden = readLegacyHiddenNames()
    return {
      ...DEFAULT_SETTINGS,
      hiddenKnowledgeBases: uniqueSorted(legacyHidden)
    }
  }
}

export function saveSettings(next: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const merged = normalize({
    ...current,
    ...next,
    autosave: { ...current.autosave, ...next.autosave },
    knowledgeBases: { ...current.knowledgeBases, ...next.knowledgeBases }
  })
  const target = settingsPath()
  const temporary = `${target}.tmp`
  writeFileSync(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  renameSync(temporary, target)
  return merged
}

export function settingsForKnowledgeBase(
  settings: AppSettings,
  knowledgeBaseId: string
): KnowledgeBaseSettings {
  return settings.knowledgeBases[knowledgeBaseId] ?? {}
}
