// @vitest-environment happy-dom
// Verify projectRawBlocksForMilkdown output + insert round-trip for each menu item.
import { describe, expect, it } from 'vitest'
import { Editor, defaultValueCtx, rootCtx, parserCtx } from '@milkdown/kit/core'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { commonmark, clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { insert } from '@milkdown/kit/utils'
import { TextSelection } from '@milkdown/kit/prose/state'

import { projectRawBlocksForMilkdown, rawBlockProjectionPlugins } from './rawBlockProjection'
import {
  computeSlashMenuViewportAdjustment,
  installSlashMenuLabelPresentation,
  menuIconFor,
  menuLabelFor,
  SLASH_MENU_ALIAS_SEPARATOR,
  SLASH_MENU_SHORTCUT_SEPARATOR,
  TN_NOTES_SLASH_ITEMS
} from '../../markdown/slashMenu'

async function createEditor(source: string): Promise<Editor> {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, projectRawBlocksForMilkdown(source))
    })
    .use(commonmark)
    .use(gfm)
    .use(rawBlockProjectionPlugins)
  await editor.create()
  return editor
}

function countBlocks(editor: Editor): number {
  let n = 0
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.state.doc.descendants((node) => {
      if (node.type.name === 'deskRawBlock') n += 1
    })
  })
  return n
}

describe('slash menu insert projection', () => {
  it('shrinks and clamps a tall slash menu to the visible editor boundary', () => {
    const boundary = {
      top: 100,
      right: 900,
      bottom: 600,
      left: 200,
      width: 700,
      height: 500
    }
    const nearTop = computeSlashMenuViewportAdjustment(
      {
        top: 30,
        right: 650,
        bottom: 510,
        left: 300,
        width: 350,
        height: 480
      },
      boundary,
      70
    )
    expect(nearTop.maxGroupHeight).toBe(414)
    expect(nearTop.deltaY).toBe(78)

    const nearBottom = computeSlashMenuViewportAdjustment(
      {
        top: 240,
        right: 980,
        bottom: 640,
        left: 630,
        width: 350,
        height: 400
      },
      boundary,
      70
    )
    expect(nearBottom.deltaY).toBe(-48)
    expect(nearBottom.deltaX).toBe(-88)
  })

  it('uses unique stable item ids and keeps aliases searchable but visually hidden', () => {
    expect(new Set(TN_NOTES_SLASH_ITEMS.map((item) => item.id)).size).toBe(
      TN_NOTES_SLASH_ITEMS.length
    )
    const mermaid = TN_NOTES_SLASH_ITEMS.find((item) => item.id === 'mermaid')!
    const searchableLabel = menuLabelFor(mermaid)
    expect(searchableLabel.startsWith(`Mermaid${SLASH_MENU_ALIAS_SEPARATOR}`)).toBe(true)
    expect(searchableLabel).toContain('mmd')
    expect(searchableLabel).toContain('流程图')
    expect(searchableLabel.toLowerCase()).toContain(' mmd ')
    expect(searchableLabel).toContain(`${SLASH_MENU_SHORTCUT_SEPARATOR}/mmd`)

    const root = document.createElement('div')
    root.innerHTML = `<div class="milkdown-slash-menu"><div class="menu-group"><ul><li><span class="milkdown-icon">icon</span><span>${searchableLabel}</span></li></ul></div></div>`
    const cleanup = installSlashMenuLabelPresentation(root)
    expect(root.querySelector('li > span:not(.milkdown-icon)')?.textContent).toBe('Mermaid')
    expect(root.querySelector('.desk-slash-menu__shortcut')?.textContent).toBe('/mmd')
    cleanup()
  })

  it('uses local accessible SVG icons instead of emoji glyphs', () => {
    for (const item of TN_NOTES_SLASH_ITEMS) {
      const icon = menuIconFor(item.kind)
      expect(icon).toContain('<svg')
      expect(icon).toContain('aria-hidden="true"')
      expect(icon).not.toMatch(/[\u{1f000}-\u{1ffff}]/u)
    }
  })

  it('keeps every item shortcut visible in its searchable menu metadata', () => {
    const shortcuts = TN_NOTES_SLASH_ITEMS.map((item) => item.shortcut)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    for (const item of TN_NOTES_SLASH_ITEMS) {
      expect(item.shortcut).toMatch(/^\/\S+$/)
      expect(menuLabelFor(item)).toContain(`${SLASH_MENU_SHORTCUT_SEPARATOR}${item.shortcut}`)
    }
  })

  it('moves keyboard hover in compact two-column visual order', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="milkdown-slash-menu" data-show="true">
        <div class="menu-groups"><div class="menu-group"><h6>Text</h6><ul>
          <li data-index="0" class="hover">A</li><li data-index="1">B</li>
          <li data-index="2">C</li><li data-index="3">D</li>
        </ul></div></div>
      </div>`
    document.body.append(root)
    const items = [...root.querySelectorAll<HTMLElement>('li[data-index]')]
    items.forEach((item) => {
      item.addEventListener('pointerenter', () => {
        items.forEach((candidate) => candidate.classList.remove('hover'))
        item.classList.add('hover')
      })
    })
    const cleanup = installSlashMenuLabelPresentation(root)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(items[2].classList.contains('hover')).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(items[3].classList.contains('hover')).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(items[1].classList.contains('hover')).toBe(true)
    expect(root.querySelector('.menu-group')?.getAttribute('data-layout')).toBe('compact-grid')
    cleanup()
  })

  for (const item of TN_NOTES_SLASH_ITEMS) {
    // 代码块由 Crepe 代码块承载（insertCodeBlock），不走 deskRawBlock 投影。
    if (item.kind === 'code') continue
    it(`inserts ${item.label} as deskRawBlock`, async () => {
      const editor = await createEditor('# A\n\n- b\n')
      const before = countBlocks(editor)
      // move selection to the very end of the document
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const end = view.state.doc.content.size
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end, end)))
      })
      editor.action((ctx) => {
        const commands = ctx.get(commandsCtx)
        commands.call(clearTextInCurrentBlockCommand.key)
        insert(projectRawBlocksForMilkdown(item.insert))(ctx)
      })
      const after = countBlocks(editor)
      expect(after).toBeGreaterThan(before)
      await editor.destroy()
      document.body.replaceChildren()
    })
  }
})

describe('projectRawBlocksForMilkdown output', () => {
  it('project <B/> component to a marker', () => {
    const out = projectRawBlocksForMilkdown('<BilibiliVideo id="" />\n')
    expect(out).toContain('<!--desk-raw-block:v1:raw-component')
  })
  it('project mermaid fence to a marker', () => {
    const out = projectRawBlocksForMilkdown('```mermaid\n\n```\n')
    expect(out).toContain('<!--desk-raw-block:v1:raw-diagram')
  })
})

describe('parse marker via parserCtx', () => {
  it('parses a projected component marker to a deskRawBlock node', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, '')
      })
      .use(commonmark)
      .use(gfm)
      .use(rawBlockProjectionPlugins)
    await editor.create()
    let parsed: { first: string; childCount: number } | null = null
    editor.action((ctx) => {
      const parser = ctx.get(parserCtx)
      const doc = parser(projectRawBlocksForMilkdown('<BilibiliVideo id="" />\n'))
      parsed = doc
        ? {
            first: doc.content.firstChild?.type?.name ?? '',
            childCount: doc.content.childCount
          }
        : null
    })
    const result = parsed as { first: string; childCount: number } | null
    expect(result?.first).toBe('deskRawBlock')
    expect(result?.childCount).toBe(1)
    await editor.destroy()
    document.body.replaceChildren()
  })
})
