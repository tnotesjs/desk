export type TocNode =
  | { type: 'group'; title: string; children: TocNode[] }
  | {
      type: 'note'
      title: string
      noteDir: string
      completed: boolean
      children: TocNode[]
    }

const NOTE_LINE = /^(\s*)-\s+\[([ xX])\]\s+(.+?)\s*$/
const GROUP_LINE = /^(\s*)-\s+(?!\[)(.+?)\s*$/

function indentLevel(spaces: string): number {
  // Support 2-space or tab-like indents used in TOC.md
  return Math.floor(spaces.replace(/\t/g, '  ').length / 2)
}

/**
 * Parse TNotes TOC.md into a tree.
 * Both plain group headings and checkbox notes may own nested children
 * (as in TNotes.docs where notes nest under notes).
 */
export function parseTocMarkdown(content: string): TocNode[] {
  const roots: TocNode[] = []
  const stack: { level: number; node: TocNode }[] = []

  const append = (level: number, node: TocNode): void => {
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop()
    }
    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }
    stack.push({ level, node })
  }

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue

    const noteMatch = line.match(NOTE_LINE)
    if (noteMatch) {
      const level = indentLevel(noteMatch[1])
      const completed = noteMatch[2].toLowerCase() === 'x'
      const title = noteMatch[3].trim()
      append(level, {
        type: 'note',
        title,
        noteDir: title,
        completed,
        children: []
      })
      continue
    }

    const groupMatch = line.match(GROUP_LINE)
    if (groupMatch) {
      const level = indentLevel(groupMatch[1])
      const title = groupMatch[2].trim()
      append(level, { type: 'group', title, children: [] })
    }
  }

  return roots
}
