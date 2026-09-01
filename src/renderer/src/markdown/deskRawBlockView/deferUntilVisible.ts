/**
 * Defer heavy NodeView mounts until the block is near the viewport.
 * Keeps first paint light for long notes with mermaid/mindmap/components.
 */
export function deferUntilVisible(
  dom: HTMLElement,
  cleanupTasks: Array<() => void>,
  mount: () => void
): void {
  // Vitest/happy-dom IntersectionObserver often never delivers callbacks.
  const isVitest =
    typeof process !== 'undefined' &&
    Boolean((process as { env?: Record<string, string | undefined> }).env?.VITEST)
  if (isVitest || typeof IntersectionObserver !== 'function') {
    mount()
    return
  }

  let mounted = false
  const finish = (): void => {
    if (mounted) return
    mounted = true
    observer.disconnect()
    mount()
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) finish()
    },
    { root: null, rootMargin: '240px 0px', threshold: 0 }
  )
  observer.observe(dom)
  cleanupTasks.push(() => observer.disconnect())
}
