import { parseFootprintsSource, type FootprintsPayload } from '@tnotesjs/ui'

import {
  isStructuredCalloutSource,
  parseContainerSource,
  rebuildContainerSource,
  renderContainerFromSource
} from '../../editor/markdown/containerBody'
import {
  bodyHasIncludeLines,
  codeGroupEntryTabTitle,
  includeLanguage,
  parseCodeGroupEntries,
  parseDeskIncludeLine,
  serializeCodeGroupEntries,
  withCodeGroupEntryLanguage,
  withCodeGroupEntryTitle,
  type CodeGroupEntry
} from '../../editor/markdown/deskInclude'
import {
  applySwiperTabsPadding,
  createSwiperTabNav,
  parseSwiperSlides,
  serializeSwiperSlides,
  swiperSlideTabTitle,
  withSwiperSlideTitle,
  wrapSlideIndex,
  type SwiperSlideEntry
} from '../../editor/markdown/swiperSlides'
import {
  mountCodeTabEditor,
  type CodeTabEditorHandle
} from '../../editor/markdown/deskCodeTabEditor'
import { mountFootprintsPreview } from '../../editor/markdown/componentPreview'
import { attachRawSourceEditor } from '../attachRawSourceEditor'
import { deferUntilVisible } from './deferUntilVisible'
import type { DeskRawBlockMountContext } from './types'

export function mountRawContainer(ctx: DeskRawBlockMountContext): void {
  const { block, dom, view, getPos, cleanupTasks, resolveImage, deps } = ctx

  const container = parseContainerSource(block.source)
  if (container.name === 'footprints') {
    dom.classList.add('desk-raw-block--footprints')
    dom.replaceChildren()
    const previewHost = document.createElement('div')
    previewHost.className = 'desk-raw-block__component-preview'
    dom.append(previewHost)
    // Resolve note-local image paths for preview only; source keeps relative URLs.
    const resolveFootprintsPreview = (source: string): FootprintsPayload => {
      const payload = parseFootprintsSource(source)
      return {
        ...payload,
        images: payload.images.map((src) => resolveImage(src))
      }
    }
    deferUntilVisible(dom, cleanupTasks, () => {
      const mounted = mountFootprintsPreview(previewHost, resolveFootprintsPreview(block.source))
      cleanupTasks.push(() => mounted.unmount())
      cleanupTasks.push(
        attachRawSourceEditor(
          {
            dom,
            source: block.source,
            view,
            getPos,
            label: '编辑 Footprints',
            structuredContainerBody: true,
            renderPreview: (source) => {
              mounted.update(resolveFootprintsPreview(source))
            }
          },
          deps
        )
      )
    })
  } else {
    let previewEl = dom.querySelector('.tn-swiper, .custom-block') as HTMLElement | null
    const structuredCallout = isStructuredCalloutSource(block.source)
    const structuredContainerBody = container.name === 'code-group' || container.name === 'swiper'
    const editable = !deps.isEffectivelyReadOnly()

    let cancelledIncludes = false
    let currentContainerSource = block.source
    let codeGroupEntries: CodeGroupEntry[] = []
    let swiperSlides: SwiperSlideEntry[] = []
    const codeGroupTabEditors: Array<CodeTabEditorHandle | null> = []
    cleanupTasks.push(() => {
      cancelledIncludes = true
      codeGroupTabEditors.splice(0).forEach((handle) => handle?.destroy())
    })

    const loadIncludeCache = async (body: string): Promise<Map<string, string>> => {
      const cache = new Map<string, string>()
      const paths: string[] = []
      for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
        const include = parseDeskIncludeLine(line)
        if (!include || cache.has(include.path) || paths.includes(include.path)) continue
        paths.push(include.path)
      }
      await Promise.all(
        paths.map(async (includePath) => {
          if (cancelledIncludes) return
          try {
            const result = await window.desk.attachments.readText({
              knowledgeBaseId: deps.knowledgeBaseId(),
              noteUuid: deps.noteUuid(),
              path: includePath
            })
            if (cancelledIncludes) return
            cache.set(
              includePath,
              result.ok ? result.value : `// 引用失败：${result.error.message}`
            )
          } catch (error) {
            if (cancelledIncludes) return
            cache.set(
              includePath,
              `// 引用失败：${error instanceof Error ? error.message : String(error)}`
            )
          }
        })
      )
      return cache
    }

    const applyContainerSource = (nextSource: string): boolean => {
      const position = getPos()
      if (position == null) return false
      const currentNode = view.state.doc.nodeAt(position)
      if (currentNode?.type.name !== 'deskRawBlock') return false
      view.dispatch(
        view.state.tr.setNodeMarkup(position, undefined, {
          ...(currentNode.attrs as Record<string, unknown>),
          source: nextSource
        })
      )
      return true
    }

    const commitCodeGroupEntries = (nextEntries: CodeGroupEntry[]): boolean => {
      const nextSource = rebuildContainerSource(currentContainerSource, {
        title: parseContainerSource(currentContainerSource).title,
        body: serializeCodeGroupEntries(nextEntries),
        name: 'code-group'
      })
      if (!applyContainerSource(nextSource)) return false
      currentContainerSource = nextSource
      codeGroupEntries = nextEntries
      return true
    }

    const remountEditableCodeGroup = async (): Promise<void> => {
      if (!previewEl) return
      const fresh = await mountEditableCodeGroup(currentContainerSource)
      if (cancelledIncludes || !previewEl || !fresh) return
      previewEl.replaceWith(fresh)
      previewEl = fresh
    }

    const mountEditableCodeGroup = async (source: string): Promise<HTMLElement | null> => {
      const parsed = parseContainerSource(source)
      if (parsed.name !== 'code-group') return null
      const entries = parseCodeGroupEntries(parsed.body)
      if (entries.length === 0) return null

      const cache = await loadIncludeCache(parsed.body)
      if (cancelledIncludes) return null

      codeGroupTabEditors.splice(0).forEach((handle) => handle?.destroy())
      codeGroupEntries = entries

      const group = document.createElement('div')
      group.className = 'custom-block custom-block-code-group desk-raw-block--code-group-editable'

      const useTabs = entries.length > 1
      const tabs = document.createElement('div')
      tabs.className = 'code-group-tabs'
      const panels = document.createElement('div')
      panels.className = useTabs ? 'code-group-panels' : 'custom-block-body'
      const tabButtons: HTMLButtonElement[] = []
      const panelEls: HTMLDivElement[] = []
      const DRAG_THRESHOLD_PX = 8

      const activateTab = (index: number): void => {
        tabButtons.forEach((button, buttonIndex) =>
          button.classList.toggle('active', buttonIndex === index)
        )
        panelEls.forEach((pane, paneIndex) => pane.classList.toggle('active', paneIndex === index))
      }

      const swapAdjacent = <T>(items: T[], index: number, toward: -1 | 1): void => {
        const other = index + toward
        const a = items[index]
        const b = items[other]
        if (a === undefined || b === undefined) return
        items[index] = b
        items[other] = a
      }

      const naturalLeft = (el: HTMLElement): number => {
        const prev = el.style.transform
        el.style.transform = 'none'
        const left = el.getBoundingClientRect().left
        el.style.transform = prev
        return left
      }

      const finishTabReorder = async (
        startIndices: number[],
        didReorder: boolean
      ): Promise<void> => {
        if (!didReorder) return
        await Promise.all(
          codeGroupTabEditors.map((handle) =>
            handle?.isDirty() ? handle.flushSave() : Promise.resolve()
          )
        )
        if (cancelledIncludes) return
        const snapshot = codeGroupEntries.slice()
        const nextEntries = startIndices.map((startIndex) => snapshot[startIndex]!)
        if (nextEntries.some((entry) => entry == null)) return
        if (!commitCodeGroupEntries(nextEntries)) return
        await remountEditableCodeGroup()
      }

      const bindTabDragReorder = (tab: HTMLButtonElement, index: number): void => {
        tab.dataset.startIndex = String(index)
        let pointerId: number | null = null
        let grabOffsetX = 0
        let startClientX = 0
        let activated = false
        let currentIndex = index
        let suppressClick = false

        const clearDragVisual = (): void => {
          tab.classList.remove('is-dragging')
          tab.style.transform = ''
          tab.style.zIndex = ''
          tabs.classList.remove('is-reordering')
        }

        tab.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return
          if (tab.querySelector('input')) return
          pointerId = event.pointerId
          currentIndex = tabButtons.indexOf(tab)
          if (currentIndex < 0) return
          startClientX = event.clientX
          grabOffsetX = event.clientX - tab.getBoundingClientRect().left
          activated = false
          suppressClick = false
          tab.setPointerCapture(event.pointerId)
        })

        tab.addEventListener('pointermove', (event) => {
          if (pointerId !== event.pointerId) return
          currentIndex = tabButtons.indexOf(tab)
          if (currentIndex < 0) return

          if (!activated) {
            if (Math.abs(event.clientX - startClientX) < DRAG_THRESHOLD_PX) return
            activated = true
            suppressClick = true
            tab.classList.add('is-dragging')
            tabs.classList.add('is-reordering')
          }

          // Keep the dragged tab under the pointer.
          const baseLeft = naturalLeft(tab)
          tab.style.transform = `translateX(${event.clientX - grabOffsetX - baseLeft}px)`
          tab.style.zIndex = '5'

          const dragCenter = event.clientX - grabOffsetX + tab.offsetWidth / 2

          // Squeeze only after crossing a neighbor's midpoint.
          if (currentIndex > 0) {
            const leftTab = tabButtons[currentIndex - 1]!
            const leftCenter = leftTab.getBoundingClientRect().left + leftTab.offsetWidth / 2
            if (dragCenter < leftCenter) {
              tabs.insertBefore(tab, leftTab)
              swapAdjacent(tabButtons, currentIndex, -1)
              currentIndex -= 1
              const nextBase = naturalLeft(tab)
              tab.style.transform = `translateX(${event.clientX - grabOffsetX - nextBase}px)`
            }
          }
          if (currentIndex < tabButtons.length - 1) {
            const rightTab = tabButtons[currentIndex + 1]!
            const rightCenter = rightTab.getBoundingClientRect().left + rightTab.offsetWidth / 2
            if (dragCenter > rightCenter) {
              tabs.insertBefore(rightTab, tab)
              swapAdjacent(tabButtons, currentIndex, 1)
              currentIndex += 1
              const nextBase = naturalLeft(tab)
              tab.style.transform = `translateX(${event.clientX - grabOffsetX - nextBase}px)`
            }
          }
        })

        const endPointer = (event: PointerEvent): void => {
          if (pointerId !== event.pointerId) return
          pointerId = null
          try {
            tab.releasePointerCapture(event.pointerId)
          } catch {
            /* already released */
          }
          const didReorder = activated
          const startIndices = tabButtons.map((button) => Number(button.dataset.startIndex))
          const orderChanged = didReorder && startIndices.some((startIndex, i) => startIndex !== i)
          clearDragVisual()
          if (orderChanged) {
            void finishTabReorder(startIndices, true)
            return
          }
          if (!suppressClick) {
            const activeIndex = tabButtons.findIndex((button) =>
              button.classList.contains('active')
            )
            const clickIndex = tabButtons.indexOf(tab)
            if (clickIndex < 0 || activeIndex === clickIndex) return
            const previous = codeGroupTabEditors[activeIndex]
            void (async () => {
              if (previous?.isDirty()) await previous.flushSave()
              if (cancelledIncludes) return
              activateTab(clickIndex)
            })()
          }
        }

        tab.addEventListener('pointerup', endPointer)
        tab.addEventListener('pointercancel', endPointer)
      }

      const startTabRename = (tab: HTMLButtonElement, index: number): void => {
        if (tab.querySelector('input')) return
        const entry = codeGroupEntries[index]
        if (!entry) return
        const previousTitle = codeGroupEntryTabTitle(entry, index)
        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'code-group-tab__rename'
        input.value = previousTitle
        input.setAttribute('aria-label', '重命名代码块标题')
        tab.replaceChildren(input)
        input.focus()
        input.select()

        let finished = false
        const finish = (commit: boolean): void => {
          if (finished) return
          finished = true
          const nextTitle = commit ? input.value.trim() : previousTitle
          const current = codeGroupEntries[index]
          if (!current) {
            tab.textContent = previousTitle
            return
          }
          if (commit && nextTitle && nextTitle !== previousTitle) {
            const nextEntries = codeGroupEntries.map((item, itemIndex) =>
              itemIndex === index ? withCodeGroupEntryTitle(item, nextTitle) : item
            )
            if (!commitCodeGroupEntries(nextEntries)) {
              tab.textContent = previousTitle
              return
            }
            tab.textContent = codeGroupEntryTabTitle(nextEntries[index]!, index)
            return
          }
          tab.textContent = codeGroupEntryTabTitle(current, index)
        }

        input.addEventListener('keydown', (event) => {
          event.stopPropagation()
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault()
            input.select()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            finish(false)
          }
        })
        input.addEventListener('blur', () => finish(true))
        input.addEventListener('click', (event) => event.stopPropagation())
        input.addEventListener('mousedown', (event) => event.stopPropagation())
      }

      entries.forEach((entry, index) => {
        const panel = document.createElement('div')
        panel.className = useTabs
          ? 'code-group-panel desk-raw-block__code-group-panel'
          : 'desk-raw-block__code-group-panel'
        const editorHost = document.createElement('div')
        editorHost.className = 'desk-raw-block__include-body'
        panel.append(editorHost)

        let initialContent = ''
        let language = ''
        if (entry.kind === 'include') {
          initialContent = cache.get(entry.include.path) ?? `// 引用失败：${entry.include.path}`
          language = includeLanguage(entry.include)
        } else {
          initialContent = entry.code
          language = entry.lang
        }

        const tabEditor = mountCodeTabEditor(editorHost, {
          initialContent,
          language,
          onCopy: (text) => deps.writeClipboard(text),
          onDirtyChange: (dirty) => {
            tabButtons[index]?.classList.toggle('is-tab-dirty', dirty)
            panel.classList.toggle('is-include-dirty', dirty)
          },
          onLanguageChange: async (nextLanguage) => {
            const current = codeGroupEntries[index]
            if (!current) return
            const nextEntries = codeGroupEntries.map((item, itemIndex) =>
              itemIndex === index ? withCodeGroupEntryLanguage(item, nextLanguage) : item
            )
            if (!commitCodeGroupEntries(nextEntries)) {
              const revertLang =
                current.kind === 'include'
                  ? includeLanguage(current.include)
                  : current.lang || 'text'
              codeGroupTabEditors[index]?.setLanguage(revertLang)
            }
          },
          onSave: async (content) => {
            const current = codeGroupEntries[index]
            if (!current) return { ok: false, message: '代码块已失效' }
            if (current.kind === 'include') {
              const write = await window.desk.attachments.writeText({
                knowledgeBaseId: deps.knowledgeBaseId(),
                noteUuid: deps.noteUuid(),
                path: current.include.path,
                content
              })
              if (!write.ok) return { ok: false, message: write.error.message }
              return { ok: true }
            }
            const nextEntries = codeGroupEntries.map((item, itemIndex) =>
              itemIndex === index && item.kind === 'fence'
                ? { ...item, code: content.replace(/\n$/, '') }
                : item
            )
            if (!commitCodeGroupEntries(nextEntries)) {
              return { ok: false, message: '无法更新笔记节点' }
            }
            return { ok: true }
          }
        })
        codeGroupTabEditors[index] = tabEditor

        if (useTabs) {
          const tab = document.createElement('button')
          tab.type = 'button'
          tab.className = 'code-group-tab'
          tab.textContent = codeGroupEntryTabTitle(entry, index)
          tab.title = '拖拽排序 · 双击重命名'
          if (index === 0) {
            tab.classList.add('active')
            panel.classList.add('active')
          }
          tab.addEventListener('dblclick', (event) => {
            event.preventDefault()
            event.stopPropagation()
            const entryIndex = Number(tab.dataset.startIndex)
            if (Number.isNaN(entryIndex)) return
            startTabRename(tab, entryIndex)
          })
          tabButtons.push(tab)
          tabs.append(tab)
          bindTabDragReorder(tab, index)
        } else {
          panel.classList.add('active')
        }
        panelEls.push(panel)
        panels.append(panel)
      })

      if (useTabs) group.append(tabs, panels)
      else group.append(panels)
      return group
    }

    const commitSwiperSlides = (nextSlides: SwiperSlideEntry[]): boolean => {
      const nextSource = rebuildContainerSource(currentContainerSource, {
        title: parseContainerSource(currentContainerSource).title,
        body: serializeSwiperSlides(nextSlides),
        name: 'swiper'
      })
      if (!applyContainerSource(nextSource)) return false
      currentContainerSource = nextSource
      swiperSlides = nextSlides
      return true
    }

    const remountEditableSwiper = (activeIndex?: number): void => {
      if (!previewEl) return
      const fresh = mountEditableSwiper(currentContainerSource, {
        activeIndex: activeIndex ?? readActiveSwiperIndex()
      })
      if (cancelledIncludes || !previewEl || !fresh) return
      previewEl.replaceWith(fresh)
      previewEl = fresh
    }

    const readActiveSwiperIndex = (): number => {
      if (!previewEl) return 0
      const tabs = [...previewEl.querySelectorAll('.tn-swiper-tabs .tn-tab')]
      const found = tabs.findIndex((tab) => tab.classList.contains('active'))
      return found >= 0 ? found : 0
    }

    const mountEditableSwiper = (
      source: string,
      options?: { activeIndex?: number }
    ): HTMLElement | null => {
      const parsed = parseContainerSource(source)
      if (parsed.name !== 'swiper') return null
      const slides = parseSwiperSlides(parsed.body)
      if (slides.length === 0) return null

      swiperSlides = slides
      const initialActiveIndex = Math.min(Math.max(0, options?.activeIndex ?? 0), slides.length - 1)
      const root = document.createElement('div')
      root.className = 'tn-swiper desk-raw-block--swiper-editable'

      const useTabs = slides.length > 1
      const tabs = document.createElement('div')
      tabs.className = 'tn-swiper-tabs'
      const container = document.createElement('div')
      container.className = 'swiper-container'
      const wrapper = document.createElement('div')
      wrapper.className = 'swiper-wrapper'
      const tabButtons: HTMLButtonElement[] = []
      const slideEls: HTMLDivElement[] = []
      const DRAG_THRESHOLD_PX = 8

      const activateSlide = (index: number): void => {
        tabButtons.forEach((button, buttonIndex) =>
          button.classList.toggle('active', buttonIndex === index)
        )
        slideEls.forEach((slide, slideIndex) => {
          const on = slideIndex === index
          slide.classList.toggle('is-active', on)
          slide.hidden = !on
        })
      }

      const activeSlideIndex = (): number => {
        const found = tabButtons.findIndex((button) => button.classList.contains('active'))
        return found >= 0 ? found : 0
      }

      applySwiperTabsPadding(tabs, useTabs)
      const nav = useTabs
        ? createSwiperTabNav({
            onPrev: () => activateSlide(wrapSlideIndex(activeSlideIndex(), slides.length, -1)),
            onNext: () => activateSlide(wrapSlideIndex(activeSlideIndex(), slides.length, 1))
          })
        : null
      if (nav) tabs.append(nav.prev, nav.line)

      const swapAdjacent = <T>(items: T[], index: number, toward: -1 | 1): void => {
        const other = index + toward
        const a = items[index]
        const b = items[other]
        if (a === undefined || b === undefined) return
        items[index] = b
        items[other] = a
      }

      const naturalLeft = (el: HTMLElement): number => {
        const prev = el.style.transform
        el.style.transform = 'none'
        const left = el.getBoundingClientRect().left
        el.style.transform = prev
        return left
      }

      const finishTabReorder = (startIndices: number[], didReorder: boolean): void => {
        if (!didReorder) return
        const snapshot = swiperSlides.slice()
        const nextSlides = startIndices.map((startIndex) => snapshot[startIndex]!)
        if (nextSlides.some((entry) => entry == null)) return
        const keepIndex = activeSlideIndex()
        if (!commitSwiperSlides(nextSlides)) return
        remountEditableSwiper(keepIndex)
      }

      const bindTabDragReorder = (tab: HTMLButtonElement, index: number): void => {
        tab.dataset.startIndex = String(index)
        let pointerId: number | null = null
        let grabOffsetX = 0
        let startClientX = 0
        let activated = false
        let currentIndex = index
        let suppressClick = false

        const clearDragVisual = (): void => {
          tab.classList.remove('is-dragging')
          tab.style.transform = ''
          tab.style.zIndex = ''
          tabs.classList.remove('is-reordering')
        }

        tab.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return
          if (tab.querySelector('input')) return
          pointerId = event.pointerId
          currentIndex = tabButtons.indexOf(tab)
          if (currentIndex < 0) return
          startClientX = event.clientX
          grabOffsetX = event.clientX - tab.getBoundingClientRect().left
          activated = false
          suppressClick = false
          tab.setPointerCapture(event.pointerId)
        })

        tab.addEventListener('pointermove', (event) => {
          if (pointerId !== event.pointerId) return
          currentIndex = tabButtons.indexOf(tab)
          if (currentIndex < 0) return

          if (!activated) {
            if (Math.abs(event.clientX - startClientX) < DRAG_THRESHOLD_PX) return
            activated = true
            suppressClick = true
            tab.classList.add('is-dragging')
            tabs.classList.add('is-reordering')
          }

          const baseLeft = naturalLeft(tab)
          tab.style.transform = `translateX(${event.clientX - grabOffsetX - baseLeft}px)`
          tab.style.zIndex = '5'

          const dragCenter = event.clientX - grabOffsetX + tab.offsetWidth / 2

          if (currentIndex > 0) {
            const leftTab = tabButtons[currentIndex - 1]!
            const leftCenter = leftTab.getBoundingClientRect().left + leftTab.offsetWidth / 2
            if (dragCenter < leftCenter) {
              tabs.insertBefore(tab, leftTab)
              swapAdjacent(tabButtons, currentIndex, -1)
              currentIndex -= 1
              const nextBase = naturalLeft(tab)
              tab.style.transform = `translateX(${event.clientX - grabOffsetX - nextBase}px)`
            }
          }
          if (currentIndex < tabButtons.length - 1) {
            const rightTab = tabButtons[currentIndex + 1]!
            const rightCenter = rightTab.getBoundingClientRect().left + rightTab.offsetWidth / 2
            if (dragCenter > rightCenter) {
              tabs.insertBefore(rightTab, tab)
              swapAdjacent(tabButtons, currentIndex, 1)
              currentIndex += 1
              const nextBase = naturalLeft(tab)
              tab.style.transform = `translateX(${event.clientX - grabOffsetX - nextBase}px)`
            }
          }
        })

        const endPointer = (event: PointerEvent): void => {
          if (pointerId !== event.pointerId) return
          pointerId = null
          try {
            tab.releasePointerCapture(event.pointerId)
          } catch {
            /* ignore */
          }
          const didReorder = activated
          const startIndices = tabButtons.map((button) => Number(button.dataset.startIndex))
          const orderChanged = didReorder && startIndices.some((startIndex, i) => startIndex !== i)
          clearDragVisual()
          if (orderChanged) {
            finishTabReorder(startIndices, true)
            return
          }
          if (!suppressClick) {
            const clickIndex = tabButtons.indexOf(tab)
            if (clickIndex >= 0) activateSlide(clickIndex)
          }
        }

        tab.addEventListener('pointerup', endPointer)
        tab.addEventListener('pointercancel', endPointer)
      }

      const startTabRename = (tab: HTMLButtonElement, index: number): void => {
        if (tab.querySelector('input')) return
        const entry = swiperSlides[index]
        if (!entry) return
        const previousTitle = swiperSlideTabTitle(entry)
        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'tn-tab__rename'
        input.value = previousTitle === 'img' && !entry.alt.trim() ? '' : previousTitle
        input.setAttribute('aria-label', '重命名轮播页标题')
        tab.replaceChildren(input)
        input.focus()
        input.select()

        let finished = false
        const finish = (commit: boolean): void => {
          if (finished) return
          finished = true
          const nextTitle = commit ? input.value.trim() : previousTitle
          const current = swiperSlides[index]
          if (!current) {
            tab.textContent = previousTitle
            return
          }
          if (commit && nextTitle !== previousTitle) {
            const nextSlides = swiperSlides.map((item, itemIndex) =>
              itemIndex === index ? withSwiperSlideTitle(item, nextTitle) : item
            )
            if (!commitSwiperSlides(nextSlides)) {
              tab.textContent = previousTitle
              return
            }
            const label = swiperSlideTabTitle(nextSlides[index]!)
            tab.textContent = label
            slideEls[index]!.dataset.title = label
            return
          }
          tab.textContent = swiperSlideTabTitle(current)
        }

        input.addEventListener('keydown', (event) => {
          // Keep shortcuts (Cmd/Ctrl+A, etc.) on this native input instead of
          // letting ProseMirror / Milkdown handle them at the doc level.
          event.stopPropagation()
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault()
            input.select()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            finish(false)
          }
        })
        input.addEventListener('blur', () => finish(true))
        input.addEventListener('click', (event) => event.stopPropagation())
        input.addEventListener('mousedown', (event) => event.stopPropagation())
      }

      slides.forEach((slide, index) => {
        const slideEl = document.createElement('div')
        slideEl.className = 'swiper-slide'
        const title = swiperSlideTabTitle(slide)
        slideEl.dataset.title = title
        const img = document.createElement('img')
        img.src = resolveImage(slide.src) || slide.src
        img.alt = slide.alt
        slideEl.append(img)
        if (index === initialActiveIndex) slideEl.classList.add('is-active')
        else slideEl.hidden = true
        slideEls.push(slideEl)
        wrapper.append(slideEl)

        if (useTabs) {
          const tab = document.createElement('button')
          tab.type = 'button'
          tab.className = 'tn-tab'
          tab.textContent = title
          tab.title = '拖拽排序 · 双击重命名'
          if (index === initialActiveIndex) tab.classList.add('active')
          tab.addEventListener('dblclick', (event) => {
            event.preventDefault()
            event.stopPropagation()
            const entryIndex = Number(tab.dataset.startIndex)
            if (Number.isNaN(entryIndex)) return
            startTabRename(tab, entryIndex)
          })
          tabButtons.push(tab)
          tabs.append(tab)
          bindTabDragReorder(tab, index)
        }
      })

      if (nav) tabs.append(nav.next)

      container.append(wrapper)
      if (useTabs) root.append(tabs, container)
      else root.append(container)
      return root
    }

    const refreshContainerPreview = async (source: string): Promise<void> => {
      if (!previewEl) return
      currentContainerSource = source
      const parsed = parseContainerSource(source)

      if (parsed.name === 'code-group' && editable) {
        const entries = parseCodeGroupEntries(parsed.body)
        if (entries.length > 0) {
          const fresh = await mountEditableCodeGroup(source)
          if (cancelledIncludes || !previewEl || !fresh) return
          previewEl.replaceWith(fresh)
          previewEl = fresh
          return
        }
      }

      if (parsed.name === 'swiper' && editable) {
        const slides = parseSwiperSlides(parsed.body)
        if (slides.length > 0) {
          const activeIndex = readActiveSwiperIndex()
          const fresh = mountEditableSwiper(source, { activeIndex })
          if (cancelledIncludes || !previewEl || !fresh) return
          previewEl.replaceWith(fresh)
          previewEl = fresh
          return
        }
      }

      let resolveIncludeContent: ((path: string) => string | null) | undefined
      if (parsed.name === 'code-group' && bodyHasIncludeLines(parsed.body)) {
        const cache = await loadIncludeCache(parsed.body)
        if (cancelledIncludes) return
        resolveIncludeContent = (path) => cache.get(path) ?? null
      }
      if (cancelledIncludes || !previewEl) return
      codeGroupTabEditors.splice(0).forEach((handle) => handle?.destroy())
      const fresh = renderContainerFromSource(source, resolveImage, {
        resolveIncludeContent
      })
      previewEl.replaceWith(fresh)
      previewEl = fresh
    }

    if (container.name === 'code-group' || (container.name === 'swiper' && editable)) {
      void refreshContainerPreview(block.source)
      if (container.name === 'code-group') {
        const acceptWriteback = (nextSource: string): boolean => {
          const nextParsed = parseContainerSource(nextSource)
          if (nextParsed.name !== 'code-group') return false
          const nextEntries = parseCodeGroupEntries(nextParsed.body)
          if (nextEntries.length !== codeGroupEntries.length) return false
          for (let i = 0; i < codeGroupEntries.length; i++) {
            const prev = codeGroupEntries[i]
            const next = nextEntries[i]
            if (!prev || !next || prev.kind !== next.kind) return false
            if (
              prev.kind === 'include' &&
              next.kind === 'include' &&
              prev.include.path !== next.include.path
            ) {
              return false
            }
          }
          currentContainerSource = nextSource
          codeGroupEntries = nextEntries
          nextEntries.forEach((entry, index) => {
            if (entry.kind === 'fence') {
              codeGroupTabEditors[index]?.setSavedValue(entry.code)
            }
          })
          return true
        }
        ;(
          dom as HTMLElement & {
            __codeGroupWriteback?: { acceptWriteback: (source: string) => boolean }
          }
        ).__codeGroupWriteback = { acceptWriteback }
        cleanupTasks.push(() => {
          delete (
            dom as HTMLElement & {
              __codeGroupWriteback?: { acceptWriteback: (source: string) => boolean }
            }
          ).__codeGroupWriteback
        })
      }
      if (container.name === 'swiper' && editable) {
        const acceptSwiperWriteback = (nextSource: string): boolean => {
          const nextParsed = parseContainerSource(nextSource)
          if (nextParsed.name !== 'swiper') return false
          const nextSlides = parseSwiperSlides(nextParsed.body)
          if (nextSlides.length !== swiperSlides.length) return false
          currentContainerSource = nextSource
          swiperSlides = nextSlides
          return true
        }
        ;(
          dom as HTMLElement & {
            __swiperWriteback?: { acceptWriteback: (source: string) => boolean }
          }
        ).__swiperWriteback = { acceptWriteback: acceptSwiperWriteback }
        cleanupTasks.push(() => {
          delete (
            dom as HTMLElement & {
              __swiperWriteback?: { acceptWriteback: (source: string) => boolean }
            }
          ).__swiperWriteback
        })
      }
    }

    cleanupTasks.push(
      attachRawSourceEditor(
        {
          dom,
          source: block.source,
          getSource: () => currentContainerSource,
          view,
          getPos,
          label: structuredCallout
            ? '编辑容器'
            : structuredContainerBody
              ? '编辑容器正文'
              : '编辑容器源码',
          structuredCallout,
          structuredContainerBody,
          renderPreview: (source) => {
            void refreshContainerPreview(source)
          }
        },
        deps
      )
    )
  }
}
