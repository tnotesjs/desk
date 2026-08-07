import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { NoteConfig, NoteInfo } from './types'

const NOTE_INDEX_REGEX = /^(\d{4})\./

export function extractNoteIndex(dirName: string): string | null {
  const match = dirName.match(NOTE_INDEX_REGEX)
  return match ? match[1] : null
}

function readNoteConfig(configPath: string): NoteConfig | undefined {
  if (!existsSync(configPath)) return undefined
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as NoteConfig
  } catch {
    return undefined
  }
}

export function scanNotes(repoRoot: string): NoteInfo[] {
  const notesPath = join(repoRoot, 'notes')
  if (!existsSync(notesPath)) return []

  const dirs = readdirSync(notesPath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        NOTE_INDEX_REGEX.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort()

  const notes: NoteInfo[] = []
  for (const dirName of dirs) {
    const notePath = join(notesPath, dirName)
    const readmePath = join(notePath, 'README.md')
    if (!existsSync(readmePath)) continue
    const configPath = join(notePath, '.tnotes.json')
    const index = extractNoteIndex(dirName)
    if (!index) continue
    notes.push({
      index,
      path: notePath,
      dirName,
      readmePath,
      configPath,
      config: readNoteConfig(configPath)
    })
  }
  return notes
}

export function generateNextNoteIndex(notes: NoteInfo[], used?: Set<number>): string {
  const usedIndexes = used ?? new Set<number>()
  if (!used) {
    for (const note of notes) {
      const id = parseInt(note.index, 10)
      if (!Number.isNaN(id) && id >= 1 && id <= 9999) usedIndexes.add(id)
    }
  }
  for (let i = 1; i <= 9999; i++) {
    if (!usedIndexes.has(i)) return String(i).padStart(4, '0')
  }
  throw new Error('所有笔记编号 (0001-9999) 已被占用')
}
