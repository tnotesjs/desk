import {
  pickedCompletion,
  type Completion,
  type CompletionSection,
  type CompletionSource
} from '@codemirror/autocomplete'
import { TNOTES_COMPONENTS, type TNotesComponentDescriptor } from '@tnotesjs/core/markdown'

interface SlashCommand {
  id: string
  label: string
  search: string
  detail: string
  section: CompletionSection
  template?: string
  selection?: readonly [number, number]
  requestImage?: boolean
}

const COMMON_SECTION: CompletionSection = { name: '常用', rank: 0 }
const BLOCK_SECTION: CompletionSection = { name: '内容块', rank: 1 }
const CORE_SECTION: CompletionSection = { name: 'TNotes Core 内置组件', rank: 2 }

const COMMON_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'paragraph',
    label: '正文',
    search: '正文 paragraph text zw',
    detail: '普通文本段落',
    section: COMMON_SECTION,
    template: '正文',
    selection: [0, 2]
  },
  ...Array.from({ length: 6 }, (_, index): SlashCommand => {
    const level = index + 1
    const prefix = `${'#'.repeat(level)} `
    return {
      id: `heading-${level}`,
      label: `标题 ${level}`,
      search: `标题 ${level} h${level} heading${level} bt${level}`,
      detail: `${level} 级标题`,
      section: COMMON_SECTION,
      template: `${prefix}标题`,
      selection: [prefix.length, prefix.length + 2]
    }
  }),
  {
    id: 'unordered-list',
    label: '无序列表',
    search: '无序列表 bullet list wxlb',
    detail: '项目符号列表',
    section: COMMON_SECTION,
    template: '- 列表项',
    selection: [2, 5]
  },
  {
    id: 'ordered-list',
    label: '有序列表',
    search: '有序列表 numbered list yxlb',
    detail: '数字编号列表',
    section: COMMON_SECTION,
    template: '1. 列表项',
    selection: [3, 6]
  },
  {
    id: 'task-list',
    label: '复选框',
    search: '复选框 checkbox task todo fuk',
    detail: '待办事项',
    section: COMMON_SECTION,
    template: '- [ ] 待办',
    selection: [6, 8]
  },
  {
    id: 'link',
    label: '链接',
    search: '链接 link url lj',
    detail: '插入 Markdown 链接',
    section: COMMON_SECTION,
    template: '[链接](https://)',
    selection: [1, 3]
  },
  {
    id: 'inline-code',
    label: '行内代码',
    search: '行内代码 inline code hn',
    detail: '当前行中的代码片段',
    section: COMMON_SECTION,
    template: '`代码`',
    selection: [1, 3]
  }
]

const BLOCK_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'code-block',
    label: '代码块',
    search: '代码块 code block dmk',
    detail: '带语言标识的围栏代码块',
    section: BLOCK_SECTION,
    template: '```ts\n代码\n```\n',
    selection: [6, 8]
  },
  {
    id: 'formula',
    label: '公式',
    search: '公式 formula latex math gongshi gs',
    detail: '支持 LaTeX 语法',
    section: BLOCK_SECTION,
    template: '$$\nE = mc^2\n$$\n',
    selection: [3, 11]
  },
  {
    id: 'image',
    label: '图片',
    search: '图片 image upload tp',
    detail: '选择本地图片',
    section: BLOCK_SECTION,
    requestImage: true
  },
  {
    id: 'table',
    label: '表格',
    search: '表格 table bg',
    detail: '2 列 Markdown 表格',
    section: BLOCK_SECTION,
    template: '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n',
    selection: [2, 5]
  }
]

function coreTemplate(component: TNotesComponentDescriptor): string {
  switch (component.name) {
    case 'BilibiliOutsidePlayer':
      return '<B id="BV1xxxxxxxxx" />\n'
    case 'EnWordList':
      return '<E :words="[\'word\']" />\n'
    case 'Footprints':
      return '<F :times="[2026, 1, 1, 0, 0]">\n<template #text-area>记录内容</template>\n</F>\n'
    case 'NotesTable':
      return '<N :ids="[\'0001\']" />\n'
    case 'Tooltip':
      return '<Tooltip text="补充说明">提示文字</Tooltip>'
    case 'MindmapPreview':
    case 'mindmap':
    case 'markmap':
      return '```mindmap\n# 根节点\n\n- 子节点\n```\n'
    case 'Mermaid':
    case 'mermaid':
      return '```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```\n'
    case 'Discussions':
      return '<Discussions />\n'
    case 'SidebarCard':
      return '<SidebarCard />\n'
    case 'swiper':
      return '::: swiper\n\n![图片](./assets/image.png)\n\n:::\n'
    case 'code-group':
      return '::: code-group\n\n```ts [TypeScript]\nconst value = 1\n```\n\n:::\n'
    case 'details':
      return '::: details 点击查看详情\n内容\n:::\n'
    case 'info':
    case 'tip':
    case 'warning':
    case 'danger':
      return `::: ${component.name}\n内容\n:::\n`
    default:
      return `<${component.name} />\n`
  }
}

const seenCoreTemplates = new Set<string>()
const CORE_COMMANDS: readonly SlashCommand[] = TNOTES_COMPONENTS.flatMap((component) => {
  const template = coreTemplate(component)
  if (seenCoreTemplates.has(template)) return []
  seenCoreTemplates.add(template)
  return [
    {
      id: `core-${component.name}`,
      label: component.name,
      search: `${component.name} ${(component.aliases ?? []).join(' ')} core component`,
      detail:
        component.kind === 'container'
          ? 'Core 容器组件'
          : component.kind === 'fenced-language'
            ? 'Core 文本绘图组件'
            : 'Core 内置组件',
      section: CORE_SECTION,
      template
    }
  ]
})

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  ...COMMON_COMMANDS,
  ...BLOCK_COMMANDS,
  ...CORE_COMMANDS
]

function completionFor(
  command: SlashCommand,
  requestImage: (position: number) => void,
  boost: number
): Completion {
  const completion: Completion = {
    label: command.search,
    displayLabel: command.label,
    detail: command.detail,
    section: command.section,
    boost,
    type: command.requestImage ? 'image' : command.id.startsWith('core-') ? 'namespace' : 'text'
  }
  completion.apply = (view, picked, from, to) => {
    const replaceFrom = Math.max(0, from - 1)
    if (command.requestImage) {
      view.dispatch({
        changes: { from: replaceFrom, to, insert: '' },
        selection: { anchor: replaceFrom },
        annotations: pickedCompletion.of(picked)
      })
      requestImage(replaceFrom)
      return
    }
    const template = command.template ?? ''
    const selection = command.selection
    view.dispatch({
      changes: { from: replaceFrom, to, insert: template },
      selection: selection
        ? { anchor: replaceFrom + selection[0], head: replaceFrom + selection[1] }
        : { anchor: replaceFrom + template.length },
      annotations: pickedCompletion.of(picked)
    })
  }
  return completion
}

export function createSlashCommandSource(
  requestImage: (position: number) => void
): CompletionSource {
  const options = SLASH_COMMANDS.map((command, index) =>
    completionFor(command, requestImage, SLASH_COMMANDS.length - index)
  )
  return (context) => {
    const line = context.state.doc.lineAt(context.pos)
    const beforeCursor = context.state.sliceDoc(line.from, context.pos)
    const match = beforeCursor.match(/^(\s*)\/([^\s/]*)$/)
    if (!match) return null
    return {
      from: line.from + match[1].length + 1,
      options,
      validFor: /^[\w\u3400-\u9fff-]*$/
    }
  }
}
