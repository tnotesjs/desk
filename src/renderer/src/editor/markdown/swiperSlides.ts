/**
 * Parse / serialize image slides inside `::: swiper` bodies.
 * Tab labels mirror core: image alt, or `img` when alt is empty.
 */

export interface SwiperSlideEntry {
  alt: string
  src: string
}

const IMAGE_LINE =
  /^ {0,3}!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)\s*$/

export function parseSwiperSlides(body: string): SwiperSlideEntry[] {
  const slides: SwiperSlideEntry[] = []
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(IMAGE_LINE)
    if (!match) continue
    slides.push({
      alt: match[1] ?? '',
      src: match[2] ?? ''
    })
  }
  return slides
}

export function swiperSlideTabTitle(entry: SwiperSlideEntry): string {
  const alt = entry.alt.trim()
  return alt || 'img'
}

export function withSwiperSlideTitle(entry: SwiperSlideEntry, title: string): SwiperSlideEntry {
  return { ...entry, alt: title.trim() }
}

export function serializeSwiperSlides(entries: SwiperSlideEntry[]): string {
  return entries.map((entry) => `![${entry.alt}](${entry.src})`).join('\n\n')
}

/** Core-parity `<` `/` `>` chrome for multi-slide swiper tabs. */
export function applySwiperTabsPadding(tabs: HTMLElement, hasNav: boolean): void {
  tabs.style.padding = hasNav ? '0 0.8rem 0 3rem' : '0 0.8rem'
}

export function createSwiperTabNav(handlers: { onPrev: () => void; onNext: () => void }): {
  prev: HTMLButtonElement
  line: HTMLSpanElement
  next: HTMLButtonElement
} {
  const prev = document.createElement('button')
  prev.type = 'button'
  prev.className = 'tn-tab-nav tn-tab-prev'
  prev.textContent = '<'
  prev.title = '上一页'
  prev.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    handlers.onPrev()
  })

  const line = document.createElement('span')
  line.className = 'tn-tab-nav tab-tab-line'
  line.textContent = '/'

  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'tn-tab-nav tn-tab-next'
  next.textContent = '>'
  next.title = '下一页'
  next.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    handlers.onNext()
  })

  return { prev, line, next }
}

export function wrapSlideIndex(index: number, length: number, delta: -1 | 1): number {
  if (length <= 0) return 0
  return (index + delta + length) % length
}
