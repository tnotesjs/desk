/**
 * src/renderer/src/markdown/slashMenu.ts
 *
 * 0005：扩展 Crepe 斜杠菜单，加入 VitePress 扩展语法与 Core 组件。
 *
 * - 只扩展 Crepe 现有的 BlockEdit 斜杠菜单（`buildMenu`），不另做右键。
 * - 每项：展示名 + 搜索词（多对一）+ 插入用的 insert 字符串。
 * - 搜索词拼进 Crepe 的内部 label，供默认 includes 过滤命中；DOM 展示层
 *   再移除分隔符后的别名，避免菜单把搜索元数据显示给用户。
 * - 容器 / 导图 / 组件插成 deskRawBlock 并打开「编辑源码」（由调用方
 *   onInsert 执行）；普通代码块交给调用方决定走 Crepe 代码块。
 *
 * 该清单同时被 0006（块级快捷输入）复用。
 */

export type SlashItemKind =
  'container' | 'code' | 'code-group' | 'swiper' | 'component' | 'mermaid' | 'mindmap'

export interface SlashMenuItem {
  /** Stable menu/test key. Never reuse `kind`: several items share one kind. */
  id: string
  /** 菜单展示名 */
  label: string
  /** 插入类型（决定如何生成 deskRawBlock） */
  kind: SlashItemKind
  /** 搜索词（多对一） */
  keywords: string[]
  /** 首选 slash 快捷词，显示在菜单行尾并同步到设置面板。 */
  shortcut: string
  /** 选中后插入的字符串（0006 复用同一份） */
  insert: string
}

/** TNotes 斜杠菜单项清单（0005 规格） */
export const TN_NOTES_SLASH_ITEMS: SlashMenuItem[] = [
  {
    id: 'tip',
    label: '提示块',
    kind: 'container',
    shortcut: '/tip',
    keywords: ['tip', ':::tip', '提示'],
    insert: '::: tip 💡 TIP\n\n\n\n:::\n'
  },
  {
    id: 'info',
    label: '信息块',
    kind: 'container',
    shortcut: '/info',
    keywords: ['info', ':::info', '信息'],
    insert: '::: info ℹ️ INFO\n\n\n\n:::\n'
  },
  {
    id: 'warning',
    label: '警告块',
    kind: 'container',
    shortcut: '/warning',
    keywords: ['warning', ':::warning', '警告'],
    insert: '::: warning ⚠️ WARNING\n\n\n\n:::\n'
  },
  {
    id: 'danger',
    label: '错误块',
    kind: 'container',
    shortcut: '/error',
    keywords: ['error', ':::error', 'danger', ':::danger', '错误'],
    insert: '::: danger ❌ ERROR\n\n\n\n:::\n'
  },
  {
    id: 'details',
    label: '细节块',
    kind: 'container',
    shortcut: '/details',
    keywords: ['details', ':::details', '细节'],
    insert: '::: details 🔍 DETAILS\n\n\n\n:::\n'
  },
  {
    id: 'code',
    label: '代码块',
    kind: 'code',
    shortcut: '/code',
    keywords: ['code', ':::code', '代码'],
    insert: '```js\n\n```\n'
  },
  {
    id: 'code-group',
    label: '代码组',
    kind: 'code-group',
    shortcut: '/code-group',
    keywords: ['code-group', ':::code-group', '代码组'],
    insert: '::: code-group\n\n```js [1]\n\n```\n\n```js [2]\n\n```\n\n:::\n'
  },
  {
    id: 'swiper',
    label: '图片轮播',
    kind: 'swiper',
    shortcut: '/swiper',
    keywords: ['swiper', ':::swiper', '轮播'],
    insert: '::: swiper\n\n![](./assets/1.png)\n\n![](./assets/2.png)\n\n:::\n'
  },
  {
    id: 'notes-table',
    label: '笔记表格',
    kind: 'component',
    shortcut: '/N',
    keywords: ['N', 'NotesTable', '笔记表格'],
    insert: '<NotesTable :ids="[\n  \'\',\n]" />\n'
  },
  {
    id: 'bilibili',
    label: 'B站视频',
    kind: 'component',
    shortcut: '/B',
    keywords: ['B', 'BilibiliVideo', 'bilibili', '视频'],
    insert: '<BilibiliVideo id="" />\n'
  },
  {
    id: 'word-list',
    label: '单词表',
    kind: 'component',
    shortcut: '/E',
    keywords: ['E', 'WordList', '单词'],
    insert: '<WordList :words="[\n  \'\',\n]" />\n'
  },
  {
    id: 'footprints',
    label: '足迹',
    kind: 'component',
    shortcut: '/F',
    keywords: ['F', 'Footprints', '足迹'],
    insert: '::: footprints 2025-01-01 12:00\n\n第一段文字\n\n第二段文字\n\n![](./assets/demo.png)\n\n:::\n'
  },
  {
    id: 'mermaid',
    label: 'Mermaid',
    kind: 'mermaid',
    shortcut: '/mmd',
    keywords: ['mermaid', 'mmd', '流程图'],
    insert: '```mermaid\n\n```\n'
  },
  {
    id: 'mindmap',
    label: '思维导图',
    kind: 'mindmap',
    shortcut: '/mmp',
    keywords: ['mindmap', 'mm', 'mmp', '思维导图'],
    insert: '```mindmap\n\n```\n'
  }
]

/**
 * Crepe only exposes `label` to its filter, so aliases have to live in it.
 * The invisible separator lets the presentation observer remove search-only
 * metadata from the rendered row without changing Crepe's reactive item data.
 */
export const SLASH_MENU_ALIAS_SEPARATOR = '\u2063'

export function menuLabelFor(item: SlashMenuItem): string {
  // Padding keeps Crepe's literal includes filter useful when the query has a
  // leading/trailing space (`/ mmd `), matching the task's trimmed-q behavior.
  return `${item.label}${SLASH_MENU_ALIAS_SEPARATOR} ${item.keywords.join(' ')} ${SLASH_MENU_ALIAS_SEPARATOR}${item.shortcut}`
}

/** Metadata separator for a shortcut hint; it is never rendered verbatim. */
export const SLASH_MENU_SHORTCUT_SEPARATOR = SLASH_MENU_ALIAS_SEPARATOR

type IconBody = string

function linearIcon(body: IconBody): string {
  return `<svg class="desk-tnotes-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

const TNOTES_ICON_BODIES: Record<SlashItemKind, IconBody> = {
  container:
    '<path d="M4 6.5 12 3l8 3.5v11L12 21l-8-3.5v-11Z"/><path d="m4 6.5 8 3.5 8-3.5M12 10v11"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  'code-group':
    '<rect x="4" y="5" width="13" height="14" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v12M7.5 9h6M7.5 13h4"/>',
  swiper:
    '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.3"/><path d="m6 17 4-4 3 3 2-2 3 3M3 12H1m22 0h-2"/>',
  component:
    '<path d="M9 4a2 2 0 0 1 4 0v1h3a2 2 0 0 1 2 2v3h1a2 2 0 1 1 0 4h-1v3a2 2 0 0 1-2 2h-3v1a2 2 0 1 1-4 0v-1H6a2 2 0 0 1-2-2v-3H3a2 2 0 1 1 0-4h1V7a2 2 0 0 1 2-2h3V4Z"/>',
  mermaid:
    '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6.5 7.5 10.8 16M17.5 7.5 13.2 16"/>',
  mindmap:
    '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M9.5 10 6.5 7.5M14.5 10l3-2.5M14.5 14l3 2.5"/>'
}

/** Shared local icon source for slash menus, block menus and tests. */
export function menuIconFor(kind: SlashItemKind): string {
  return linearIcon(TNOTES_ICON_BODIES[kind])
}

/**
 * Crepe has no separate search keywords field or custom filter hook. Keep the
 * full label in its Vue model for filtering, but present only the user-facing
 * part in the DOM. A subtree observer also cleans rows created by later query
 * changes. This deliberately touches text only; item keys and event handlers
 * remain owned by Crepe.
 */
const SLASH_MENU_VIEWPORT_GAP = 8
const SLASH_MENU_DEFAULT_GROUP_HEIGHT = 420
const SLASH_MENU_MIN_GROUP_HEIGHT = 112

interface RectLike {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface SlashMenuViewportAdjustment {
  maxGroupHeight: number
  deltaX: number
  deltaY: number
}

/**
 * Pure geometry used by the runtime presenter and unit tests. `menuRect` must
 * already reflect `maxGroupHeight`; callers can therefore measure once, apply
 * the height, then measure again before asking for the final coordinate delta.
 */
export function computeSlashMenuViewportAdjustment(
  menuRect: RectLike,
  boundary: RectLike,
  chromeHeight: number
): SlashMenuViewportAdjustment {
  const usableHeight = Math.max(0, boundary.height - SLASH_MENU_VIEWPORT_GAP * 2)
  const maxGroupHeight = Math.max(
    SLASH_MENU_MIN_GROUP_HEIGHT,
    Math.min(SLASH_MENU_DEFAULT_GROUP_HEIGHT, usableHeight - chromeHeight)
  )
  const minTop = boundary.top + SLASH_MENU_VIEWPORT_GAP
  const maxBottom = boundary.bottom - SLASH_MENU_VIEWPORT_GAP
  const minLeft = boundary.left + SLASH_MENU_VIEWPORT_GAP
  const maxRight = boundary.right - SLASH_MENU_VIEWPORT_GAP

  let deltaY = 0
  if (menuRect.top < minTop) deltaY = minTop - menuRect.top
  else if (menuRect.bottom > maxBottom) deltaY = maxBottom - menuRect.bottom

  let deltaX = 0
  if (menuRect.left < minLeft) deltaX = minLeft - menuRect.left
  else if (menuRect.right > maxRight) deltaX = maxRight - menuRect.right

  return { maxGroupHeight, deltaX, deltaY }
}

function visibleBoundary(root: HTMLElement): RectLike {
  const rootRect = root.getBoundingClientRect()
  const top = Math.max(0, rootRect.top)
  // Vertically, the menu must remain inside the scrollable editor. A narrow
  // editor pane can be smaller than the menu itself, so horizontally allow it
  // to use the whole application viewport (while still preventing window
  // overflow).
  const left = 0
  const right = window.innerWidth
  const bottom = Math.min(window.innerHeight, rootRect.bottom)
  return {
    top,
    right,
    bottom,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  }
}

function restoreProviderPosition(menu: HTMLElement): void {
  const appliedTop = menu.dataset.deskAppliedTop
  const appliedLeft = menu.dataset.deskAppliedLeft
  if (appliedTop && menu.style.top === appliedTop && menu.dataset.deskProviderTop) {
    menu.style.top = menu.dataset.deskProviderTop
  } else if (menu.style.top) {
    menu.dataset.deskProviderTop = menu.style.top
  }
  if (appliedLeft && menu.style.left === appliedLeft && menu.dataset.deskProviderLeft) {
    menu.style.left = menu.dataset.deskProviderLeft
  } else if (menu.style.left) {
    menu.dataset.deskProviderLeft = menu.style.left
  }
  delete menu.dataset.deskAppliedTop
  delete menu.dataset.deskAppliedLeft
}

function constrainSlashMenu(menu: HTMLElement, boundary: RectLike): void {
  if (menu.dataset.show !== 'true') return
  const groups = menu.querySelector<HTMLElement>('.menu-groups')
  if (!groups) return

  restoreProviderPosition(menu)
  groups.style.maxHeight = `${SLASH_MENU_DEFAULT_GROUP_HEIGHT}px`
  const chromeHeight = Math.max(0, menu.offsetHeight - groups.offsetHeight)
  const first = computeSlashMenuViewportAdjustment(
    menu.getBoundingClientRect(),
    boundary,
    chromeHeight
  )
  groups.style.maxHeight = `${first.maxGroupHeight}px`

  // Applying max-height can shrink the floating element. Measure the actual
  // box before adjusting its provider-owned absolute coordinates.
  const adjusted = computeSlashMenuViewportAdjustment(
    menu.getBoundingClientRect(),
    boundary,
    chromeHeight
  )
  const menuRect = menu.getBoundingClientRect()
  const actionMenu = document.querySelector<HTMLElement>('.desk-block-action-menu')
  const actionRect = actionMenu?.getBoundingClientRect()
  let obstacleDeltaX = 0
  if (
    actionRect &&
    menuRect.left < actionRect.right &&
    menuRect.right > actionRect.left &&
    menuRect.top < actionRect.bottom &&
    menuRect.bottom > actionRect.top
  ) {
    const right = actionRect.right + SLASH_MENU_VIEWPORT_GAP
    const left = actionRect.left - menuRect.width - SLASH_MENU_VIEWPORT_GAP
    if (right + menuRect.width <= boundary.right - SLASH_MENU_VIEWPORT_GAP) {
      obstacleDeltaX = right - menuRect.left
    } else if (left >= boundary.left + SLASH_MENU_VIEWPORT_GAP) {
      obstacleDeltaX = left - menuRect.left
    }
  }
  const currentTop = Number.parseFloat(menu.style.top)
  if (Number.isFinite(currentTop) && adjusted.deltaY !== 0) {
    const next = `${currentTop + adjusted.deltaY}px`
    menu.style.top = next
    menu.dataset.deskAppliedTop = next
  }
  const currentLeft = Number.parseFloat(menu.style.left)
  if (Number.isFinite(currentLeft) && (adjusted.deltaX !== 0 || obstacleDeltaX !== 0)) {
    const next = `${currentLeft + adjusted.deltaX + obstacleDeltaX}px`
    menu.style.left = next
    menu.dataset.deskAppliedLeft = next
  }
}

/**
 * Presentation layer shared by slash-triggered and programmatic (+ / add
 * below) menus. It keeps search aliases out of the visible label and constrains
 * every open menu to the editor's actually visible viewport.
 */
export function installSlashMenuPresentation(root: HTMLElement): () => void {
  let frame = 0
  const present = (): void => {
    root
      .querySelectorAll<HTMLElement>(
        '.milkdown-slash-menu .menu-group li > span:not(.milkdown-icon)'
      )
      .forEach((label) => {
        const text = label.textContent ?? ''
        const separator = text.indexOf(SLASH_MENU_ALIAS_SEPARATOR)
        if (separator < 0) return
        const metadata = text.slice(separator + SLASH_MENU_ALIAS_SEPARATOR.length)
        const shortcutSeparator = metadata.lastIndexOf(SLASH_MENU_SHORTCUT_SEPARATOR)
        const shortcut =
          shortcutSeparator >= 0
            ? metadata.slice(shortcutSeparator + SLASH_MENU_SHORTCUT_SEPARATOR.length).trim()
            : ''
        label.textContent = text.slice(0, separator)
        const item = label.parentElement
        if (!item) return
        item.dataset.shortcut = shortcut
        item.querySelector('.desk-slash-menu__shortcut')?.remove()
        if (!shortcut) return
        const hint = document.createElement('span')
        hint.className = 'desk-slash-menu__shortcut'
        hint.textContent = shortcut
        hint.setAttribute('aria-label', `快捷方式 ${shortcut}`)
        item.append(hint)
      })
    root.querySelectorAll<HTMLElement>('.milkdown-slash-menu .menu-group').forEach((group) => {
      group.dataset.layout = 'compact-grid'
    })
    const boundary = visibleBoundary(root)
    root
      .querySelectorAll<HTMLElement>('.milkdown-slash-menu')
      .forEach((menu) => constrainSlashMenu(menu, boundary))
  }

  const schedule = (): void => {
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      present()
    })
  }

  const observer = new MutationObserver(schedule)
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-show']
  })
  root.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule, { passive: true })
  const onKeydown = (event: KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    const menu = root.querySelector<HTMLElement>('.milkdown-slash-menu[data-show="true"]')
    if (!menu) return
    const items = [...menu.querySelectorAll<HTMLElement>('li[data-index]')]
    if (!items.length) return
    const current = Math.max(
      0,
      items.findIndex((item) => item.classList.contains('hover'))
    )
    const currentItem = items[current]
    const currentGroup = currentItem?.closest<HTMLElement>('.menu-group')
    const groupItems = currentGroup
      ? [...currentGroup.querySelectorAll<HTMLElement>('li[data-index]')]
      : []
    const localIndex = Math.max(0, groupItems.indexOf(currentItem))
    const columns = 2
    let nextItem: HTMLElement | undefined
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const offset = event.key === 'ArrowDown' ? columns : -columns
      nextItem = groupItems[localIndex + offset]
      if (!nextItem) {
        const groups = [...menu.querySelectorAll<HTMLElement>('.menu-group')]
        const groupIndex = currentGroup ? groups.indexOf(currentGroup) : -1
        const adjacent = groups[groupIndex + (event.key === 'ArrowDown' ? 1 : -1)]
        const adjacentItems = adjacent
          ? [...adjacent.querySelectorAll<HTMLElement>('li[data-index]')]
          : []
        nextItem = adjacentItems[event.key === 'ArrowDown' ? 0 : adjacentItems.length - 1]
      }
    } else {
      const offset = event.key === 'ArrowRight' ? 1 : -1
      nextItem = groupItems[localIndex + offset]
      if (
        !nextItem ||
        Math.floor((localIndex + offset) / columns) !== Math.floor(localIndex / columns)
      ) {
        const groups = [...menu.querySelectorAll<HTMLElement>('.menu-group')]
        const groupIndex = currentGroup ? groups.indexOf(currentGroup) : -1
        const adjacent = groups[groupIndex + (event.key === 'ArrowRight' ? 1 : -1)]
        const adjacentItems = adjacent
          ? [...adjacent.querySelectorAll<HTMLElement>('li[data-index]')]
          : []
        nextItem = adjacentItems[event.key === 'ArrowRight' ? 0 : adjacentItems.length - 1]
      }
    }
    const next = nextItem ? items.indexOf(nextItem) : current
    if (next === current) return
    event.preventDefault()
    event.stopImmediatePropagation()
    items[next].dispatchEvent(
      new PointerEvent('pointerenter', {
        bubbles: false,
        clientX: next + 1,
        clientY: next + 1
      })
    )
    items[next].scrollIntoView({ block: 'nearest' })
  }
  window.addEventListener('keydown', onKeydown, { capture: true })
  present()
  schedule()
  return () => {
    observer.disconnect()
    root.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    window.removeEventListener('keydown', onKeydown, { capture: true })
    if (frame) cancelAnimationFrame(frame)
  }
}

/** @deprecated Use installSlashMenuPresentation. */
export const installSlashMenuLabelPresentation = installSlashMenuPresentation

export interface TNotesSlashGroupOptions {
  /** 菜单组 label */
  groupLabel?: string
  /** 每项的 onRun 执行回调 */
  onRun: (item: SlashMenuItem, ctx: unknown) => void
}

interface AddItemArg {
  label: string
  icon: string
  onRun?: (ctx: unknown) => void
}

interface GroupHandle {
  addItem: (key: string, item: AddItemArg) => unknown
}

interface GroupBuilderLike {
  addGroup: (key: string, label: string) => GroupHandle
}

/**
 * 在 Crepe BlockEdit GroupBuilder 上追加 TNotes 组。
 * 搜索词并入 label（空格分隔），供 Crepe 默认 includes 过滤命中。
 */
export function buildTNotesSlashGroup(
  builder: GroupBuilderLike,
  options: TNotesSlashGroupOptions
): void {
  const group = builder.addGroup('tnotes', options.groupLabel ?? 'TNotes')
  for (const item of TN_NOTES_SLASH_ITEMS) {
    group.addItem(item.id, {
      label: menuLabelFor(item),
      icon: menuIconFor(item.kind),
      onRun: (ctx: unknown) => {
        options.onRun(item, ctx)
      }
    })
  }
}
