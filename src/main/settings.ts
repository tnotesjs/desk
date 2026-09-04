import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { clampAppZoom, APP_ZOOM_DEFAULT } from '../shared/appZoom'

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
  defaultNoteView: z.enum(['visual', 'readonly', 'source']).default('visual'),
  defaultNotePageWidth: z.enum(['standard', 'wide']).default('standard'),
  noteTocDisplay: z.enum(['hidden', 'collapsed', 'expanded']).default('expanded'),
  appZoomPercent: z.number().transform(clampAppZoom).default(APP_ZOOM_DEFAULT),
  autosave: z
    .object({
      enabled: z.boolean().default(true),
      delayMs: z.number().int().min(250).max(30_000).default(1000)
    })
    .default({ enabled: true, delayMs: 1000 }),
  createNotePosition: z.enum(['top', 'end']).default('top'),
  workspaceLayout: z.enum(['kb-dir-content', 'content-dir-kb']).default('kb-dir-content'),
  prettier: z.boolean().default(true),
  ide: z.enum(['vscode', 'cursor']).default('vscode'),
  gitPath: z.string().trim().min(1).nullable().default(null),
  nodePath: z.string().trim().min(1).nullable().default(null),
  confirmBeforeCommit: z.boolean().default(false),
  tabs: z
    .object({
      maxOpenCount: z.number().int().min(1).max(30).default(10),
      wrap: z.boolean().default(true),
      autoRevealInToc: z.boolean().default(true)
    })
    .default({ maxOpenCount: 10, wrap: true, autoRevealInToc: true }),
  toc: z
    .object({
      showNoteIndex: z.boolean().default(true),
      showNoteStatus: z.boolean().default(true),
      doneEmoji: z.string().default('✅'),
      undoneEmoji: z.string().default('⏰'),
      changesCollapsedByDefault: z.boolean().default(true)
    })
    .default({
      showNoteIndex: true,
      showNoteStatus: true,
      doneEmoji: '✅',
      undoneEmoji: '⏰',
      changesCollapsedByDefault: true
    }),
  imageUpload: z
    .object({
      defaultTarget: z.enum(['local', 'github']).default('local'),
      github: z
        .object({
          repository: z.string().trim().default(''),
          branch: z.string().trim().min(1).default('main'),
          path: z.string().trim().default('/'),
          cdnTemplate: z
            .string()
            .trim()
            .min(1)
            .default('https://cdn.jsdelivr.net/gh/${username}/${repository}@${branch}/${filepath}'),
          fileNameFormat: z.string().trim().min(1).default('${YY}-${MM}-${DD}-${HH}-${mm}-${ss}')
        })
        .default({
          repository: '',
          branch: 'main',
          path: '/',
          cdnTemplate:
            'https://cdn.jsdelivr.net/gh/${username}/${repository}@${branch}/${filepath}',
          fileNameFormat: '${YY}-${MM}-${DD}-${HH}-${mm}-${ss}'
        })
    })
    .default({
      defaultTarget: 'local',
      github: {
        repository: '',
        branch: 'main',
        path: '/',
        cdnTemplate: 'https://cdn.jsdelivr.net/gh/${username}/${repository}@${branch}/${filepath}',
        fileNameFormat: '${YY}-${MM}-${DD}-${HH}-${mm}-${ss}'
      }
    }),
  hiddenKnowledgeBases: z.array(z.string().min(1)).default([]),
  updates: z
    .object({
      autoCheck: z.boolean().default(true)
    })
    .default({ autoCheck: true }),
  knowledgeBases: z.record(z.string(), knowledgeBaseSettingsSchema).default({})
})

const DEFAULT_SETTINGS: AppSettings = settingsSchema.parse({})

function settingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, '.tn-desk-config.json')
}

function legacySettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function legacyV1SettingsPath(): string {
  return join(app.getPath('userData'), 'settings.v1.json')
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
  // Preserve a zoom value saved while the earlier note-only implementation was in use.
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : null
  const parsed = settingsSchema.parse(
    raw
      ? {
          ...raw,
          appZoomPercent:
            raw.appZoomPercent === undefined ? raw.noteZoomPercent : raw.appZoomPercent
        }
      : input
  )
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
    try {
      const migrated = normalize(JSON.parse(readFileSync(legacyV1SettingsPath(), 'utf8')))
      writeSettingsFile(migrated)
      return migrated
    } catch {
      const legacyHidden = readLegacyHiddenNames()
      return {
        ...DEFAULT_SETTINGS,
        hiddenKnowledgeBases: uniqueSorted(legacyHidden)
      }
    }
  }
}

function writeSettingsFile(settings: AppSettings): AppSettings {
  const target = settingsPath()
  const temporary = `${target}.tmp`
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  renameSync(temporary, target)
  return settings
}

export function saveSettings(next: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const merged = normalize({
    ...current,
    ...next,
    autosave: { ...current.autosave, ...next.autosave },
    tabs: { ...current.tabs, ...next.tabs },
    imageUpload: {
      ...current.imageUpload,
      ...next.imageUpload,
      github: { ...current.imageUpload.github, ...next.imageUpload?.github }
    },
    knowledgeBases: { ...current.knowledgeBases, ...next.knowledgeBases }
  })
  return writeSettingsFile(merged)
}

export function resetSettings(): AppSettings {
  return writeSettingsFile(DEFAULT_SETTINGS)
}

export function readSettingsFile(): string {
  return `${JSON.stringify(loadSettings(), null, 2)}\n`
}

export function importSettings(content: string): AppSettings {
  const parsed = JSON.parse(content) as unknown
  return writeSettingsFile(normalize(parsed))
}

export function writeSettingsRaw(json: string): AppSettings {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (cause) {
    throw new Error(
      `配置文件不是合法的 JSON：${cause instanceof Error ? cause.message : String(cause)}`
    )
  }
  return writeSettingsFile(normalize(parsed))
}

export function settingsForKnowledgeBase(
  settings: AppSettings,
  knowledgeBaseId: string
): KnowledgeBaseSettings {
  return settings.knowledgeBases[knowledgeBaseId] ?? {}
}
