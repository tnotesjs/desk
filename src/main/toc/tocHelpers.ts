/**
 * utils/tocHelpers.ts
 *
 * 根目录 TOC.md 解析、序列化与 sidebar 树构建
 */

import { computeSidebarNodeId } from './tocNodeId'

import type { NoteInfo, NoteConfig } from './types'

/** 每级缩进空格数 */
export const TOC_INDENT_SPACES = 2

export type TocLineKind = 'folder' | 'note' | 'unknown'

/** TOC 行解析结果 */
export interface ParsedTocLine {
  kind: TocLineKind
  isMatch: boolean
  indentLevel: number
  noteIndex: string | null
  folderTitle: string | null
  completed: boolean
  rawLine: string
}

/** 目录节点 */
export interface TocFolderNode {
  kind: 'folder'
  title: string
  indent: number
  tocLineIndex: number
  children: TocTreeNode[]
}

/** 笔记节点（可有 children，语雀式父笔记） */
export interface TocNoteNode {
  kind: 'note'
  noteIndex: string
  indent: number
  tocLineIndex: number
  children: TocTreeNode[]
}

export type TocTreeNode = TocFolderNode | TocNoteNode

/** @deprecated 使用 TocTreeNode */
export type TocNode = TocTreeNode

/** Sidebar 项（与 VitePress sidebar 结构一致） */
export interface TocSidebarItem {
  text: string
  link?: string
  collapsed?: boolean
  items?: TocSidebarItem[]
  /** 纯目录节点路径（从根到当前目录的标题链，仅 UI 展示） */
  folderPath?: string[]
  /** TOC.md 中对应行的 0-based 行号（CRUD/拖拽主键） */
  tocLineIndex?: number
  /** dev 拖拽用确定性 nodeId（不写 TOC.md） */
  nodeId?: string
}

/** legacy：- [x] [0001. 标题](/notes/...) */
const TOC_LEGACY_FULL_REGEX =
  /^( *)(-\s+\[(x| )\])\s+\[(\d{4}\.[^\]]+)\]\(([^)]+)\)/

/** canonical 笔记：- [x] 0001. 标题 或 - [ ] 0001 */
const TOC_NOTE_LINE_REGEX =
  /^( *)(-\s+\[(x| )\])\s+(\d{4})(?:\.\s*(.*))?\s*$/

/** 目录：- 标题（无 checkbox） */
const TOC_FOLDER_LINE_REGEX = /^( *)(-\s+(?!\[(?:x| )\]).+?)\s*$/

function extractNoteIndexFromTitle(text: string): string | null {
  const match = text.match(/^(\d{4})\./)
  return match ? match[1] : null
}

function parseIndent(spaces: string | undefined): number {
  return Math.floor((spaces?.length ?? 0) / TOC_INDENT_SPACES)
}

/**
 * 解析 TOC.md 单行
 */
export function parseTocLine(line: string | undefined | null): ParsedTocLine {
  const rawLine = line ?? ''
  const empty: ParsedTocLine = {
    kind: 'unknown',
    isMatch: false,
    indentLevel: 0,
    noteIndex: null,
    folderTitle: null,
    completed: false,
    rawLine,
  }

  if (line == null) return empty

  const legacyMatch = line.match(TOC_LEGACY_FULL_REGEX)
  if (legacyMatch) {
    const [, spaces, , statusChar, titleText] = legacyMatch
    const noteIndex = extractNoteIndexFromTitle(titleText)
    if (!noteIndex) return empty
    return {
      kind: 'note',
      isMatch: true,
      indentLevel: parseIndent(spaces),
      noteIndex,
      folderTitle: null,
      completed: statusChar === 'x',
      rawLine,
    }
  }

  const noteMatch = line.match(TOC_NOTE_LINE_REGEX)
  if (noteMatch) {
    const [, spaces, , statusChar, noteIndex] = noteMatch
    return {
      kind: 'note',
      isMatch: true,
      indentLevel: parseIndent(spaces),
      noteIndex,
      folderTitle: null,
      completed: statusChar === 'x',
      rawLine,
    }
  }

  const folderMatch = line.match(TOC_FOLDER_LINE_REGEX)
  if (folderMatch) {
    const [, spaces, titlePart] = folderMatch
    const title = titlePart.replace(/^-\s+/, '').trim()
    if (!title) return empty
    return {
      kind: 'folder',
      isMatch: true,
      indentLevel: parseIndent(spaces),
      noteIndex: null,
      folderTitle: title,
      completed: false,
      rawLine,
    }
  }

  return empty
}

export function isTocContentLine(line: string): boolean {
  return parseTocLine(line).isMatch
}

/**
 * 从 notes 列表按索引查找笔记
 */
export function resolveNoteFromIndex(
  index: string,
  notes: NoteInfo[],
): NoteInfo | undefined {
  return notes.find((n) => n.index === index)
}

/**
 * 根据笔记配置决定 checkbox 状态
 */
export function getTocLineCompleted(
  note: NoteInfo,
  configOverride?: Partial<NoteConfig>,
): boolean {
  const config = configOverride
    ? { ...note.config, ...configOverride }
    : note.config
  return config?.done ?? false
}

/** 去掉 dirName 的编号前缀，用作目录标题 */
export function folderTitleFromNoteDirName(dirName: string): string {
  return dirName.replace(/^\d{4}\.\s*/, '').trim() || dirName
}

/**
 * 构建目录 TOC 行
 */
export function buildFolderTocLine(title: string, indentLevel: number): string {
  const indent = ' '.repeat(indentLevel * TOC_INDENT_SPACES)
  return `${indent}- ${title}`
}

/**
 * 构建笔记 TOC 行（无 link）
 */
export function buildTocLine(
  note: NoteInfo,
  indentLevel: number,
  completed?: boolean,
): string {
  const indent = ' '.repeat(indentLevel * TOC_INDENT_SPACES)
  const status = (completed ?? getTocLineCompleted(note)) ? 'x' : ' '
  return `${indent}- [${status}] ${note.dirName}`
}

interface MutableTreeNode {
  kind: 'folder' | 'note'
  title?: string
  noteIndex?: string
  indent: number
  tocLineIndex: number
  children: MutableTreeNode[]
}

function mutableToTreeNode(node: MutableTreeNode): TocTreeNode {
  if (node.kind === 'folder') {
    return {
      kind: 'folder',
      title: node.title!,
      indent: node.indent,
      tocLineIndex: node.tocLineIndex,
      children: node.children.map(mutableToTreeNode),
    }
  }
  return {
    kind: 'note',
    noteIndex: node.noteIndex!,
    indent: node.indent,
    tocLineIndex: node.tocLineIndex,
    children: node.children.map(mutableToTreeNode),
  }
}

function buildMutableTreeFromFlat(
  flatNodes: Array<{
    kind: 'folder' | 'note'
    title?: string
    noteIndex?: string
    indent: number
    tocLineIndex: number
  }>,
): MutableTreeNode[] {
  const roots: MutableTreeNode[] = []
  const stack: MutableTreeNode[] = []

  for (const item of flatNodes) {
    while (stack.length > 0 && stack[stack.length - 1].indent >= item.indent) {
      stack.pop()
    }

    const node: MutableTreeNode = {
      kind: item.kind,
      title: item.title,
      noteIndex: item.noteIndex,
      indent: item.indent,
      tocLineIndex: item.tocLineIndex,
      children: [],
    }

    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }

    stack.push(node)
  }

  return roots
}

/**
 * @deprecated 不再自动拆分父笔记；保留供旧测试/脚本引用
 */
export function migrateLegacyNoteParents(
  roots: MutableTreeNode[],
  _notes: NoteInfo[],
): TocTreeNode[] {
  return roots.map(mutableToTreeNode)
}

/**
 * 将 flat 行解析为可变森林
 */
export function parseTocToMutableTree(
  lines: string[],
  notes: NoteInfo[],
): MutableTreeNode[] {
  const flatNodes: Array<{
    kind: 'folder' | 'note'
    title?: string
    noteIndex?: string
    indent: number
    tocLineIndex: number
  }> = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    const parsed = parseTocLine(line)
    if (!parsed.isMatch) continue

    if (parsed.kind === 'folder') {
      flatNodes.push({
        kind: 'folder',
        title: parsed.folderTitle!,
        indent: parsed.indentLevel,
        tocLineIndex: lineIndex,
      })
      continue
    }

    if (!parsed.noteIndex) continue
    if (!resolveNoteFromIndex(parsed.noteIndex, notes)) continue

    flatNodes.push({
      kind: 'note',
      noteIndex: parsed.noteIndex,
      indent: parsed.indentLevel,
      tocLineIndex: lineIndex,
    })
  }

  return buildMutableTreeFromFlat(flatNodes)
}

/**
 * 将 flat 行解析为 canonical 森林
 */
export function parseTocToTree(
  lines: string[],
  notes: NoteInfo[],
): TocTreeNode[] {
  return parseTocToMutableTree(lines, notes).map(mutableToTreeNode)
}

/**
 * @deprecated 使用 parseTocToTree；保留供过渡期调用
 */
export function buildTreeFromFlatNodes(flatNodes: TocNode[]): TocTreeNode[] {
  const mutable: MutableTreeNode[] = flatNodes.map((node) => {
    if (node.kind === 'folder') {
      return {
        kind: 'folder',
        title: node.title,
        indent: node.indent,
        tocLineIndex: node.tocLineIndex,
        children: flattenMutableFromTree(node.children),
      }
    }
    return {
      kind: 'note',
      noteIndex: node.noteIndex,
      indent: node.indent,
      tocLineIndex: node.tocLineIndex,
      children: flattenMutableFromTree(node.children),
    }
  })
  return mutable.map(mutableToTreeNode)
}

function flattenMutableFromTree(nodes: TocTreeNode[]): MutableTreeNode[] {
  const result: MutableTreeNode[] = []
  for (const node of nodes) {
    if (node.kind === 'folder') {
      result.push({
        kind: 'folder',
        title: node.title,
        indent: node.indent,
        tocLineIndex: node.tocLineIndex,
        children: flattenMutableFromTree(node.children),
      })
    } else {
      result.push({
        kind: 'note',
        noteIndex: node.noteIndex,
        indent: node.indent,
        tocLineIndex: node.tocLineIndex,
        children: flattenMutableFromTree(node.children),
      })
    }
  }
  return result
}

/**
 * 深度优先序列化 TOC 树为 flat 行
 */
export function serializeTocTree(
  tree: TocTreeNode[],
  notes: NoteInfo[],
  configByIndex?: Map<string, Partial<NoteConfig>>,
): string[] {
  const lines: string[] = []

  function walk(nodes: TocTreeNode[]) {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        lines.push(buildFolderTocLine(node.title, node.indent))
        walk(node.children)
        continue
      }

      const note = resolveNoteFromIndex(node.noteIndex, notes)
      if (!note) continue
      const override = configByIndex?.get(node.noteIndex)
      const completed =
        override !== undefined
          ? getTocLineCompleted(note, override)
          : getTocLineCompleted(note)
      lines.push(buildTocLine(note, node.indent, completed))
      walk(node.children)
    }
  }

  walk(tree)
  return lines
}

/**
 * 从 flat 解析结果提取笔记条目
 */
export function parseTocLinesToFlatNodes(lines: string[]): Array<{
  noteIndex: string
  indent: number
  completed: boolean
}> {
  const result: Array<{
    noteIndex: string
    indent: number
    completed: boolean
  }> = []

  for (const line of lines) {
    const parsed = parseTocLine(line)
    if (parsed.kind !== 'note' || !parsed.noteIndex) continue
    result.push({
      noteIndex: parsed.noteIndex,
      indent: parsed.indentLevel,
      completed: parsed.completed,
    })
  }

  return result
}

/**
 * 笔记行子树范围 [start, end)
 */
export function getSubtreeLineRange(
  lines: string[],
  startLineIndex: number,
): { start: number; end: number } {
  const parsed = parseTocLine(lines[startLineIndex])
  if (parsed.kind !== 'note') {
    return { start: startLineIndex, end: startLineIndex + 1 }
  }

  const baseIndent = parsed.indentLevel
  let end = startLineIndex + 1

  for (let i = startLineIndex + 1; i < lines.length; i++) {
    const next = parseTocLine(lines[i])
    if (next.isMatch && next.indentLevel <= baseIndent) break
    end = i + 1
  }

  return { start: startLineIndex, end }
}

/**
 * folder / note 通用子树范围 [start, end)
 */
/**
 * 从 lines 中移除 [removedStart, removedEnd) 后，校正基于原行号的索引。
 */
export function adjustTocLineIndexAfterSubtreeRemoval(
  lineIndex: number,
  removedStart: number,
  removedEnd: number,
): number {
  if (lineIndex >= removedEnd) {
    return lineIndex - (removedEnd - removedStart)
  }
  return lineIndex
}

export function getTocEntrySubtreeRange(
  lines: string[],
  lineIndex: number,
): { start: number; end: number } {
  const parsed = parseTocLine(lines[lineIndex])
  if (!parsed.isMatch) {
    return { start: lineIndex, end: lineIndex + 1 }
  }

  const baseIndent = parsed.indentLevel
  let end = lineIndex + 1

  for (let i = lineIndex + 1; i < lines.length; i++) {
    const next = parseTocLine(lines[i])
    if (next.isMatch && next.indentLevel <= baseIndent) break
    end = i + 1
  }

  return { start: lineIndex, end }
}

/**
 * 收集子树内所有笔记编号（含根若为 note）
 */
export function collectNoteIndexesInSubtree(
  lines: string[],
  lineIndex: number,
): string[] {
  const { start, end } = getTocEntrySubtreeRange(lines, lineIndex)
  const indexes: string[] = []

  for (let i = start; i < end; i++) {
    const parsed = parseTocLine(lines[i])
    if (parsed.noteIndex) {
      indexes.push(parsed.noteIndex)
    }
  }

  return indexes
}

/**
 * 重命名目录行（仅改标题，保留缩进）
 */
export function renameFolderLine(
  lines: string[],
  lineIndex: number,
  newTitle: string,
): string[] {
  const parsed = parseTocLine(lines[lineIndex])
  if (parsed.kind !== 'folder') {
    throw new Error(`TOC 行 ${lineIndex} 不是目录行`)
  }

  const trimmed = newTitle.trim()
  if (!trimmed) {
    throw new Error('目录标题不能为空')
  }

  const result = [...lines]
  result[lineIndex] = buildFolderTocLine(trimmed, parsed.indentLevel)
  return result
}

/**
 * 删除子树前，获取子树之前文档顺序中的最后一篇笔记 index
 */
export function getPreviousNoteIndexOutsideSubtree(
  lines: string[],
  lineIndex: number,
): string | null {
  const { start } = getTocEntrySubtreeRange(lines, lineIndex)
  let lastBefore: string | null = null

  for (let i = 0; i < start; i++) {
    const parsed = parseTocLine(lines[i])
    if (parsed.noteIndex) {
      lastBefore = parsed.noteIndex
    }
  }

  return lastBefore
}

/**
 * 判断 noteIndex 是否位于指定 TOC 行子树内
 */
export function isNoteIndexInSubtree(
  lines: string[],
  lineIndex: number,
  noteIndex: string,
): boolean {
  const indexes = collectNoteIndexesInSubtree(lines, lineIndex)
  return indexes.includes(noteIndex)
}

/**
 * 目录行子树范围 [start, end)
 */
export function getFolderSubtreeRange(
  lines: string[],
  startLineIndex: number,
): { start: number; end: number } {
  const parsed = parseTocLine(lines[startLineIndex])
  if (parsed.kind !== 'folder') {
    return { start: startLineIndex, end: startLineIndex + 1 }
  }

  const baseIndent = parsed.indentLevel
  let end = startLineIndex + 1

  for (let i = startLineIndex + 1; i < lines.length; i++) {
    const next = parseTocLine(lines[i])
    if (next.isMatch && next.indentLevel <= baseIndent) break
    end = i + 1
  }

  return { start: startLineIndex, end }
}

/**
 * 按标题路径查找目录行索引
 */
export function findFolderLineIndex(
  lines: string[],
  folderPath: string[],
): number {
  const target = folderPath.join('/')
  const stack: Array<{ title: string; indent: number }> = []

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTocLine(lines[i])
    if (!parsed.isMatch) continue

    while (stack.length > 0 && stack[stack.length - 1].indent >= parsed.indentLevel) {
      stack.pop()
    }

    if (parsed.kind === 'folder') {
      const path = [...stack.map((s) => s.title), parsed.folderTitle!].join('/')
      if (path === target) return i
      stack.push({ title: parsed.folderTitle!, indent: parsed.indentLevel })
    }
  }

  throw new Error(`TOC.md 中未找到目录: ${folderPath.join(' > ')}`)
}

/**
 * 查找 noteIndex 对应的首行索引
 */
export function findTocLineIndex(lines: string[], noteIndex: string): number {
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTocLine(lines[i])
    if (parsed.noteIndex === noteIndex) return i
  }
  throw new Error(`TOC.md 中未找到笔记: ${noteIndex}`)
}

/**
 * 查找任意 TOC 行（笔记或目录）索引
 */
export function findTocEntryLineIndex(
  lines: string[],
  target:
    | { targetType: 'note'; noteIndex: string }
    | { targetType: 'folder'; folderPath: string[] }
    | { targetType: 'line'; tocLineIndex: number },
): number {
  if (target.targetType === 'line') {
    return target.tocLineIndex
  }
  if (target.targetType === 'note') {
    return findTocLineIndex(lines, target.noteIndex)
  }
  return findFolderLineIndex(lines, target.folderPath)
}

/**
 * 按 TOC 文档顺序获取被删笔记的上一项索引；首项返回 null（回退 README）
 */
export function getPreviousTocNoteIndex(
  lines: string[],
  noteIndex: string,
): string | null {
  const flat = parseTocLinesToFlatNodes(lines)
  const index = flat.findIndex((node) => node.noteIndex === noteIndex)
  if (index === -1) {
    throw new Error(`TOC.md 中未找到笔记: ${noteIndex}`)
  }
  if (index <= 0) return null
  return flat[index - 1].noteIndex
}

/**
 * 合并连续空行，移除相邻 TOC 行之间的空行
 */
export function processTocEmptyLines(lines: string[]): string[] {
  const result: string[] = []
  let previousEmpty = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      const prev = i > 0 ? lines[i - 1] : null
      const next = i < lines.length - 1 ? lines[i + 1] : null
      if (prev && next && isTocContentLine(prev) && isTocContentLine(next)) {
        continue
      }
      if (!previousEmpty) {
        result.push(line)
        previousEmpty = true
      }
    } else {
      result.push(line)
      previousEmpty = false
    }
  }

  return result
}

/**
 * 从 TOC.md 内容解析完成笔记数量
 */
export function parseTocCompletedNotes(content: string): {
  completedCount: number
  totalCount: number
  notes: Array<{ noteIndex: string; completed: boolean; line: string }>
} {
  const lines = content.split('\n')
  const noteMap = new Map<
    string,
    { noteIndex: string; completed: boolean; line: string }
  >()

  for (const line of lines) {
    const parsed = parseTocLine(line)
    if (parsed.kind !== 'note' || !parsed.noteIndex) continue

    const noteIndex = parsed.noteIndex
    const completed = parsed.completed

    if (noteMap.has(noteIndex)) {
      const existing = noteMap.get(noteIndex)!
      if (existing.completed !== completed) {
        throw new Error(
          `发现相同编号 ${noteIndex} 的笔记有不同的完成状态:\n` +
            `  第一次出现: ${existing.line}\n` +
            `  第二次出现: ${line.trim()}`,
        )
      }
      continue
    }

    noteMap.set(noteIndex, {
      noteIndex,
      completed,
      line: line.trim(),
    })
  }

  const notes = Array.from(noteMap.values())
  return {
    completedCount: notes.filter((n) => n.completed).length,
    totalCount: notes.length,
    notes,
  }
}

/**
 * 从 TOC 树构建 VitePress sidebar 结构
 */
export function buildSidebarFromTocTree(
  tree: TocTreeNode[],
  notes: NoteInfo[],
  options: {
    sidebarShowNoteId: boolean
    sidebarIsCollapsed?: boolean
  },
  parentFolderPath: string[] = [],
): TocSidebarItem[] {
  const collapsed = options.sidebarIsCollapsed ?? true

  function mapNote(
    node: TocNoteNode,
    currentFolderPath: string[],
  ): TocSidebarItem | null {
    const note = resolveNoteFromIndex(node.noteIndex, notes)
    if (!note) return null

    let statusEmoji = '⏰ '
    if (note.config?.done) {
      statusEmoji = '✅ '
    }

    let displayText = note.dirName
    if (!options.sidebarShowNoteId) {
      displayText = note.dirName.replace(/^\d{4}\.\s/, '')
    }

    const childItems = node.children
      .map((child) => mapNode(child, currentFolderPath))
      .filter((item): item is TocSidebarItem => item !== null)

    if (childItems.length > 0) {
      const item: TocSidebarItem = {
        text: statusEmoji + displayText,
        link: `/notes/${note.dirName}/README`,
        collapsed,
        items: childItems,
        tocLineIndex: node.tocLineIndex,
      }
      item.nodeId = computeSidebarNodeId(item)
      return item
    }

    const item: TocSidebarItem = {
      text: statusEmoji + displayText,
      link: `/notes/${note.dirName}/README`,
      tocLineIndex: node.tocLineIndex,
    }
    item.nodeId = computeSidebarNodeId(item)
    return item
  }

  function mapFolder(
    node: TocFolderNode,
    folderPath: string[],
  ): TocSidebarItem | null {
    const childItems = node.children
      .map((child) => mapNode(child, folderPath))
      .filter((item): item is TocSidebarItem => item !== null)

    if (childItems.length === 0) {
      const item: TocSidebarItem = {
        text: node.title,
        collapsed,
        items: [],
        folderPath,
        tocLineIndex: node.tocLineIndex,
      }
      item.nodeId = computeSidebarNodeId(item)
      return item
    }

    const item: TocSidebarItem = {
      text: node.title,
      collapsed,
      items: childItems,
      folderPath,
      tocLineIndex: node.tocLineIndex,
    }
    item.nodeId = computeSidebarNodeId(item)
    return item
  }

  function mapNode(
    node: TocTreeNode,
    currentFolderPath: string[],
  ): TocSidebarItem | null {
    if (node.kind === 'folder') {
      const folderPath = [...currentFolderPath, node.title]
      return mapFolder(node, folderPath)
    }
    return mapNote(node, currentFolderPath)
  }

  return tree
    .map((node) => mapNode(node, parentFolderPath))
    .filter((item): item is TocSidebarItem => item !== null)
}
