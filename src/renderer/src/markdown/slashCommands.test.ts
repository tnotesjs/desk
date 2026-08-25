// @vitest-environment happy-dom

import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'

import { createSlashCommandSource } from './slashCommands'

async function completions(source: string): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc: source })
  const result = await createSlashCommandSource(() => undefined)(
    new CompletionContext(state, source.length, false)
  )
  return result ?? null
}

describe('visual slash commands', () => {
  it('shows the required common, block and Core commands on an empty visual line', async () => {
    const result = await completions('/')
    const labels = result?.options.map((option) => option.displayLabel)

    expect(labels).toEqual(
      expect.arrayContaining([
        '正文',
        '标题 1',
        '标题 6',
        '无序列表',
        '有序列表',
        '复选框',
        '链接',
        '行内代码',
        '代码块',
        '公式',
        '图片',
        '表格',
        'BilibiliOutsidePlayer',
        'Mermaid',
        'swiper'
      ])
    )
  })

  it('does not interrupt a slash typed in ordinary paragraph text', async () => {
    expect(await completions('正文 /')).toBeNull()
  })

  it('replaces the slash query and selects the inserted heading placeholder', async () => {
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: '/h2' })
    })
    const result = await createSlashCommandSource(() => undefined)(
      new CompletionContext(view.state, view.state.doc.length, false, view)
    )
    const heading = result?.options.find((option) => option.displayLabel === '标题 2') as Completion

    expect(heading).toBeTruthy()
    ;(heading.apply as Exclude<Completion['apply'], string | undefined>)(
      view,
      heading,
      result!.from,
      view.state.doc.length
    )

    expect(view.state.doc.toString()).toBe('## 标题')
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      '标题'
    )
    view.destroy()
  })

  it('removes the slash before opening the existing image workflow', async () => {
    const requestImage = vi.fn()
    const parent = document.createElement('div')
    const view = new EditorView({ parent, state: EditorState.create({ doc: '/image' }) })
    const result = await createSlashCommandSource(requestImage)(
      new CompletionContext(view.state, view.state.doc.length, false, view)
    )
    const image = result?.options.find((option) => option.displayLabel === '图片') as Completion

    ;(image.apply as Exclude<Completion['apply'], string | undefined>)(
      view,
      image,
      result!.from,
      view.state.doc.length
    )

    expect(view.state.doc.toString()).toBe('')
    expect(requestImage).toHaveBeenCalledWith(0)
    view.destroy()
  })
})
