import { describe, expect, it } from 'vitest'

import { parseDeskIncludeLine } from './deskInclude'
import {
  mindmapPreviewMarkdown,
  rebuildMindmapFence
} from './mindmapFence'

describe('parseDeskIncludeLine', () => {
  it('parses path, optional lang, and title', () => {
    expect(parseDeskIncludeLine('<<< ./assets/1.md')).toEqual({ path: './assets/1.md' })
    expect(parseDeskIncludeLine('<<< ./assets/2.md [学习计划]')).toEqual({
      path: './assets/2.md',
      title: '学习计划'
    })
    expect(parseDeskIncludeLine('<<< ./assets/2.js {js} [Scripty]')).toEqual({
      path: './assets/2.js',
      lang: 'js',
      title: 'Scripty'
    })
  })
})

describe('mindmapPreviewMarkdown', () => {
  it('applies fence title as the H1 root', () => {
    const source = '```mindmap [项目架构]\n- Web 应用\n- VSCode 插件\n```\n'
    const { markdown, initialExpandLevel } = mindmapPreviewMarkdown(source)
    expect(markdown).toBe('# 项目架构\n\n- Web 应用\n- VSCode 插件\n')
    expect(initialExpandLevel).toBe(3)
  })

  it('reads expand level from fence meta', () => {
    const source = '```mindmap [学习计划] 1\n- a\n  - a1\n```\n'
    const { markdown, initialExpandLevel } = mindmapPreviewMarkdown(source)
    expect(markdown.startsWith('# 学习计划')).toBe(true)
    expect(initialExpandLevel).toBe(1)
  })
})

describe('rebuildMindmapFence', () => {
  it('keeps fence title style and updates body from session markdown', () => {
    const original = '```mindmap [项目架构]\n- old\n```\n'
    const next = rebuildMindmapFence(original, {
      markdown: '# 项目架构\n\n- Web 应用\n- VSCode 插件\n'
    })
    expect(next).toBe('```mindmap [项目架构]\n- Web 应用\n- VSCode 插件\n```\n')
  })

  it('writes expand level into fence meta', () => {
    const original = '```mindmap [学习计划]\n- a\n```\n'
    const next = rebuildMindmapFence(original, { initialExpandLevel: 2 })
    expect(next.startsWith('```mindmap [学习计划] 2\n')).toBe(true)
  })

  it('preserves body H1 style when fence has no title', () => {
    const original = '```mindmap\n# TNotes\n\n- a\n```\n'
    const next = rebuildMindmapFence(original, {
      markdown: '# TNotes\n\n- a\n- b\n'
    })
    expect(next).toBe('```mindmap\n# TNotes\n\n- a\n- b\n```\n')
  })
})
