/**
 * vitepress/components/Layout/sidebarItemRenderLogic.ts
 *
 * 侧边栏项渲染模式：决定 folder / parent-note / leaf / hidden
 */

export interface SidebarRenderItem {
  text: string
  link?: string
  items?: SidebarRenderItem[]
}

export type SidebarItemRenderMode =
  | 'pure-folder'
  | 'parent-note'
  | 'leaf'
  | 'hidden'

export function hasSidebarChildren(item: SidebarRenderItem): boolean {
  return !!(item.items && item.items.length > 0)
}

export function isPureSidebarFolder(item: SidebarRenderItem): boolean {
  return hasSidebarChildren(item) && !item.link
}

/**
 * @param maxDepth 最大可见层级（0 或负数表示不限制）
 */
export function getSidebarItemRenderMode(
  item: SidebarRenderItem,
  depth: number,
  maxDepth: number,
): SidebarItemRenderMode {
  const hasDepthLimit = maxDepth > 0 && Number.isFinite(maxDepth)

  if (isPureSidebarFolder(item) && (!hasDepthLimit || depth < maxDepth)) {
    return 'pure-folder'
  }

  if (hasSidebarChildren(item) && (!hasDepthLimit || depth < maxDepth)) {
    return 'parent-note'
  }

  if (!hasSidebarChildren(item) && item.link) {
    return 'leaf'
  }

  return 'hidden'
}
