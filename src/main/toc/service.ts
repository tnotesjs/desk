/**
 * Repo-scoped TOC/Note operations for Desk (adapted from @tnotesjs/core TocService).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  promises as fsPromises
} from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { generateNextNoteIndex, scanNotes } from './notes'
import {
  adjustTocLineIndexAfterSubtreeRemoval,
  buildFolderTocLine,
  buildSidebarFromTocTree,
  buildTocLine,
  collectNoteIndexesInSubtree,
  findFolderLineIndex,
  findTocLineIndex,
  getTocEntrySubtreeRange,
  getTocLineCompleted,
  parseTocLine,
  parseTocToTree,
  processTocEmptyLines,
  renameFolderLine,
  resolveNoteFromIndex,
  TOC_INDENT_SPACES,
  type TocTreeNode
} from './tocHelpers'
import { nodeIdForFolder, nodeIdForNote, parseNodeId } from './tocNodeId'
import type { NoteConfig, NoteInfo } from './types'

const NEW_NOTE_BODY = `
<!-- region:toc -->

- [1. 本节内容](#1-本节内容)
- [2. 评价](#2-评价)

<!-- endregion:toc -->

## 1. 本节内容

- todo

## 2. 评价

- todo
`

export type NoteInsertPlacement = 'before' | 'after'

export type MoveTocEntryTarget =
  | {
      targetTocLineIndex: number
      placement: NoteInsertPlacement | 'inside'
    }
  | {
      targetType: 'note'
      targetNoteIndex: string
      placement: NoteInsertPlacement | 'inside'
    }
  | {
      targetType: 'folder'
      targetFolderPath: string[]
      placement: NoteInsertPlacement | 'inside'
    }

/** Renderer-facing TOC tree */
export type DeskTocNode =
  | {
      type: 'group'
      title: string
      tocLineIndex: number
      nodeId: string
      folderPath: string[]
      children: DeskTocNode[]
    }
  | {
      type: 'note'
      title: string
      noteDir: string
      noteIndex: string
      tocLineIndex: number
      nodeId: string
      completed: boolean
      children: DeskTocNode[]
    }

function tocPath(repoRoot: string): string {
  return join(repoRoot, 'TOC.md')
}

function sidebarPath(repoRoot: string): string {
  return join(repoRoot, 'sidebar.json')
}

function notesDir(repoRoot: string): string {
  return join(repoRoot, 'notes')
}

function readRepoName(repoRoot: string): string {
  try {
    const raw = readFileSync(join(repoRoot, '.tnotes.json'), 'utf-8')
    const data = JSON.parse(raw) as { repoName?: string }
    if (data.repoName) return data.repoName
  } catch {
    // fall through
  }
  return repoRoot.split(/[/\\]/).pop() || 'TNotes'
}

function githubNotesUrl(repoRoot: string): string {
  const name = readRepoName(repoRoot)
  return `https://github.com/tnotesjs/${name}/tree/main/notes`
}

async function readTocLines(repoRoot: string): Promise<string[]> {
  const file = tocPath(repoRoot)
  if (!existsSync(file)) {
    throw new Error(`TOC.md 不存在: ${file}`)
  }
  const content = await fsPromises.readFile(file, 'utf-8')
  return content.split('\n')
}

async function writeTocLines(repoRoot: string, lines: string[]): Promise<void> {
  const content = processTocEmptyLines(lines).join('\n')
  await fsPromises.writeFile(tocPath(repoRoot), content, 'utf-8')
}

function adjustSubtreeIndent(lines: string[], delta: number): string[] {
  if (delta === 0) return lines
  return lines.map((line) => {
    const parsed = parseTocLine(line)
    if (!parsed.isMatch) return line
    const newIndent = Math.max(0, parsed.indentLevel + delta)
    return `${' '.repeat(newIndent * TOC_INDENT_SPACES)}${line.trimStart()}`
  })
}

function resolveMoveTargetLineIndex(lines: string[], target: MoveTocEntryTarget): number {
  if ('targetTocLineIndex' in target) return target.targetTocLineIndex
  if (target.targetType === 'folder') return findFolderLineIndex(lines, target.targetFolderPath)
  return findTocLineIndex(lines, target.targetNoteIndex)
}

function toDeskNodes(
  tree: TocTreeNode[],
  notes: NoteInfo[],
  folderPath: string[] = []
): DeskTocNode[] {
  const result: DeskTocNode[] = []
  for (const node of tree) {
    if (node.kind === 'folder') {
      const path = [...folderPath, node.title]
      result.push({
        type: 'group',
        title: node.title,
        tocLineIndex: node.tocLineIndex,
        nodeId: nodeIdForFolder(path),
        folderPath: path,
        children: toDeskNodes(node.children, notes, path)
      })
      continue
    }
    const note = resolveNoteFromIndex(node.noteIndex, notes)
    if (!note) continue
    result.push({
      type: 'note',
      title: note.dirName,
      noteDir: note.dirName,
      noteIndex: node.noteIndex,
      tocLineIndex: node.tocLineIndex,
      nodeId: nodeIdForNote(node.noteIndex),
      completed: getTocLineCompleted(note),
      children: toDeskNodes(node.children, notes, folderPath)
    })
  }
  return result
}

export function readDeskToc(repoRoot: string): DeskTocNode[] {
  const file = tocPath(repoRoot)
  if (!existsSync(file)) {
    throw new Error(`TOC.md 不存在`)
  }
  const notes = scanNotes(repoRoot)
  const lines = readFileSync(file, 'utf-8').split('\n')
  const tree = parseTocToTree(lines, notes)
  return toDeskNodes(tree, notes)
}

export async function regenerateSidebar(repoRoot: string, notes?: NoteInfo[]): Promise<void> {
  const allNotes = notes ?? scanNotes(repoRoot)
  const lines = await readTocLines(repoRoot)
  const tree = parseTocToTree(lines, allNotes)
  let sidebarShowNoteId = false
  try {
    const cfg = JSON.parse(readFileSync(join(repoRoot, '.tnotes.json'), 'utf-8')) as {
      sidebarShowNoteId?: boolean
    }
    sidebarShowNoteId = Boolean(cfg.sidebarShowNoteId)
  } catch {
    // ignore
  }
  const hierarchical = buildSidebarFromTocTree(tree, allNotes, {
    sidebarShowNoteId,
    sidebarIsCollapsed: true
  })
  writeFileSync(sidebarPath(repoRoot), JSON.stringify(hierarchical, null, 2), 'utf-8')
}

async function refreshAfterMutation(repoRoot: string): Promise<DeskTocNode[]> {
  const notes = scanNotes(repoRoot)
  await regenerateSidebar(repoRoot, notes)
  return readDeskToc(repoRoot)
}

export async function createNotes(
  repoRoot: string,
  options: {
    count?: number
    title?: string
    parentTocLineIndex?: number
    aroundNoteIndex?: string
    placement?: NoteInsertPlacement
  } = {}
): Promise<DeskTocNode[]> {
  const count = Math.max(1, options.count ?? 1)
  const title = (options.title ?? 'new').trim() || 'new'
  const notes = scanNotes(repoRoot)
  const used = new Set(notes.map((n) => parseInt(n.index, 10)))
  const created: NoteInfo[] = []
  const baseUrl = githubNotesUrl(repoRoot)

  for (let i = 0; i < count; i++) {
    const noteIndex = generateNextNoteIndex(notes, used)
    used.add(parseInt(noteIndex, 10))
    const noteTitle = count > 1 ? `${title} ${i + 1}` : title
    const dirName = `${noteIndex}. ${noteTitle}`
    const notePath = join(notesDir(repoRoot), dirName)
    mkdirSync(notePath, { recursive: true })
    const readmePath = join(notePath, 'README.md')
    const heading = `# [${dirName}](${baseUrl}/${encodeURIComponent(dirName)})`
    writeFileSync(readmePath, `${heading}\n${NEW_NOTE_BODY}`, 'utf-8')
    const configPath = join(notePath, '.tnotes.json')
    const config: NoteConfig = {
      id: randomUUID(),
      bilibili: [],
      tnotes: [],
      yuque: [],
      done: false,
      enableDiscussions: false
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    const info: NoteInfo = {
      index: noteIndex,
      path: notePath,
      dirName,
      readmePath,
      configPath,
      config
    }
    created.push(info)
    notes.push(info)
  }

  const lines = await readTocLines(repoRoot)

  if (options.aroundNoteIndex && options.placement) {
    const targetIndex = findTocLineIndex(lines, options.aroundNoteIndex)
    const targetParsed = parseTocLine(lines[targetIndex])
    const indent = targetParsed.indentLevel
    const noteLines = created.map((note) => buildTocLine(note, indent, false))
    const insertIndex =
      options.placement === 'before'
        ? targetIndex
        : getTocEntrySubtreeRange(lines, targetIndex).end
    lines.splice(insertIndex, 0, ...noteLines)
  } else if (options.parentTocLineIndex !== undefined) {
    const parentParsed = parseTocLine(lines[options.parentTocLineIndex])
    if (!parentParsed.isMatch) throw new Error(`无效的 TOC 行: ${options.parentTocLineIndex}`)
    const childIndent = parentParsed.indentLevel + 1
    const { end } = getTocEntrySubtreeRange(lines, options.parentTocLineIndex)
    const noteLines = created.map((note) => buildTocLine(note, childIndent, false))
    lines.splice(end, 0, ...noteLines)
  } else {
    for (const note of created) {
      lines.push(buildTocLine(note, 0, false))
    }
  }

  await writeTocLines(repoRoot, lines)
  return refreshAfterMutation(repoRoot)
}

export async function createFolder(
  repoRoot: string,
  options: { title: string; parentTocLineIndex?: number }
): Promise<DeskTocNode[]> {
  const title = options.title.trim()
  if (!title) throw new Error('目录标题不能为空')
  const lines = await readTocLines(repoRoot)

  if (options.parentTocLineIndex !== undefined) {
    const parentParsed = parseTocLine(lines[options.parentTocLineIndex])
    if (!parentParsed.isMatch) throw new Error(`无效的 TOC 行: ${options.parentTocLineIndex}`)
    const childIndent = parentParsed.indentLevel + 1
    const { end } = getTocEntrySubtreeRange(lines, options.parentTocLineIndex)
    lines.splice(end, 0, buildFolderTocLine(title, childIndent))
  } else {
    lines.push(buildFolderTocLine(title, 0))
  }

  await writeTocLines(repoRoot, lines)
  return refreshAfterMutation(repoRoot)
}

export async function renameNote(
  repoRoot: string,
  noteIndex: string,
  newTitle: string
): Promise<DeskTocNode[]> {
  const title = newTitle.trim()
  if (!title) throw new Error('笔记标题不能为空')
  const notes = scanNotes(repoRoot)
  const note = resolveNoteFromIndex(noteIndex, notes)
  if (!note) throw new Error(`笔记不存在: ${noteIndex}`)

  const newDirName = title.match(/^\d{4}\./) ? title : `${noteIndex}. ${title}`
  const newPath = join(notesDir(repoRoot), newDirName)
  if (newPath !== note.path) {
    if (existsSync(newPath)) throw new Error(`目标目录已存在: ${newDirName}`)
    renameSync(note.path, newPath)
  }

  const lines = await readTocLines(repoRoot)
  const tempNote: NoteInfo = { ...note, dirName: newDirName, path: newPath }
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTocLine(lines[i])
    if (parsed.noteIndex === noteIndex) {
      lines[i] = buildTocLine(tempNote, parsed.indentLevel, parsed.completed)
    }
  }
  await writeTocLines(repoRoot, lines)
  return refreshAfterMutation(repoRoot)
}

export async function renameFolder(
  repoRoot: string,
  tocLineIndex: number,
  newTitle: string
): Promise<DeskTocNode[]> {
  const lines = await readTocLines(repoRoot)
  const updated = renameFolderLine(lines, tocLineIndex, newTitle)
  await writeTocLines(repoRoot, updated)
  return refreshAfterMutation(repoRoot)
}

export async function deleteNote(repoRoot: string, noteIndex: string): Promise<DeskTocNode[]> {
  const notes = scanNotes(repoRoot)
  const note = resolveNoteFromIndex(noteIndex, notes)
  if (!note) throw new Error(`笔记不存在: ${noteIndex}`)

  const lines = await readTocLines(repoRoot)
  try {
    const lineIndex = findTocLineIndex(lines, noteIndex)
    const { start, end } = getTocEntrySubtreeRange(lines, lineIndex)
    const subtreeIndexes = collectNoteIndexesInSubtree(lines, lineIndex)
    lines.splice(start, end - start)
    await writeTocLines(repoRoot, lines)

    for (const idx of subtreeIndexes) {
      const n = resolveNoteFromIndex(idx, scanNotes(repoRoot))
      if (n) await fsPromises.rm(n.path, { recursive: true, force: true })
    }
  } catch {
    await fsPromises.rm(note.path, { recursive: true, force: true })
  }

  return refreshAfterMutation(repoRoot)
}

export async function deleteEntry(
  repoRoot: string,
  tocLineIndex: number
): Promise<DeskTocNode[]> {
  const lines = await readTocLines(repoRoot)
  const noteIndexes = collectNoteIndexesInSubtree(lines, tocLineIndex)
  const { start, end } = getTocEntrySubtreeRange(lines, tocLineIndex)
  lines.splice(start, end - start)
  await writeTocLines(repoRoot, lines)

  const notes = scanNotes(repoRoot)
  for (const idx of noteIndexes) {
    const n = resolveNoteFromIndex(idx, notes)
    if (n) await fsPromises.rm(n.path, { recursive: true, force: true })
  }

  return refreshAfterMutation(repoRoot)
}

export async function moveTocEntryByLineIndex(
  repoRoot: string,
  sourceTocLineIndex: number,
  target: MoveTocEntryTarget
): Promise<DeskTocNode[]> {
  const lines = await readTocLines(repoRoot)
  const sourceParsed = parseTocLine(lines[sourceTocLineIndex])
  if (!sourceParsed.isMatch) throw new Error(`无效的 TOC 行索引: ${sourceTocLineIndex}`)

  const { start, end } = getTocEntrySubtreeRange(lines, sourceTocLineIndex)
  const resolvedTargetIndex = resolveMoveTargetLineIndex(lines, target)

  if (resolvedTargetIndex >= start && resolvedTargetIndex < end) {
    throw new Error('不能移动到自身或子树内')
  }

  const movingLines = lines.splice(start, end - start)
  const targetLineIndex = adjustTocLineIndexAfterSubtreeRemoval(
    resolvedTargetIndex,
    start,
    end
  )
  const targetParsed = parseTocLine(lines[targetLineIndex])
  if (!targetParsed.isMatch) throw new Error(`无效的目标 TOC 行索引: ${targetLineIndex}`)

  let insertIndex: number
  let newIndent: number
  if (target.placement === 'inside') {
    insertIndex = targetLineIndex + 1
    newIndent = targetParsed.indentLevel + 1
  } else if (target.placement === 'before') {
    insertIndex = targetLineIndex
    newIndent = targetParsed.indentLevel
  } else {
    insertIndex = getTocEntrySubtreeRange(lines, targetLineIndex).end
    newIndent = targetParsed.indentLevel
  }

  const oldBaseIndent = parseTocLine(movingLines[0]).indentLevel
  const adjusted = adjustSubtreeIndent(movingLines, newIndent - oldBaseIndent)
  lines.splice(insertIndex, 0, ...adjusted)
  await writeTocLines(repoRoot, lines)
  return refreshAfterMutation(repoRoot)
}

function resolveNodeIdToTocLineIndex(lines: string[], nodeId: string): number {
  const parsed = parseNodeId(nodeId)
  if (parsed.kind === 'note' && parsed.noteIndex) {
    return findTocLineIndex(lines, parsed.noteIndex)
  }
  if (parsed.kind === 'line' && parsed.tocLineIndex !== undefined) {
    return parsed.tocLineIndex
  }
  if (parsed.kind === 'folder' && parsed.folderPath) {
    return findFolderLineIndex(lines, parsed.folderPath)
  }
  throw new Error(`无法解析 nodeId: ${nodeId}`)
}

export async function reorderByNodeId(
  repoRoot: string,
  payload: {
    nodeId: string
    action: 'moveAfter' | 'prependChild'
    targetNodeId?: string
  }
): Promise<DeskTocNode[]> {
  const lines = await readTocLines(repoRoot)
  const sourceIndex = resolveNodeIdToTocLineIndex(lines, payload.nodeId)

  if (payload.action === 'prependChild' && !payload.targetNodeId) {
    let targetLineIndex = 0
    while (targetLineIndex < lines.length && !parseTocLine(lines[targetLineIndex]).isMatch) {
      targetLineIndex++
    }
    if (targetLineIndex >= lines.length) throw new Error('TOC.md 为空')
    return moveTocEntryByLineIndex(repoRoot, sourceIndex, {
      targetTocLineIndex: targetLineIndex,
      placement: 'before'
    })
  }

  if (!payload.targetNodeId) throw new Error('缺少 targetNodeId')
  const targetIndex = resolveNodeIdToTocLineIndex(lines, payload.targetNodeId)

  if (payload.action === 'prependChild') {
    return moveTocEntryByLineIndex(repoRoot, sourceIndex, {
      targetTocLineIndex: targetIndex,
      placement: 'inside'
    })
  }

  return moveTocEntryByLineIndex(repoRoot, sourceIndex, {
    targetTocLineIndex: targetIndex,
    placement: 'after'
  })
}
