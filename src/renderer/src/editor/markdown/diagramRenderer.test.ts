// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { parseFencedCode, renderDiagram } from './diagramRenderer'

describe('parseFencedCode', () => {
  it('extracts the language and body from a mermaid fence', () => {
    const result = parseFencedCode('```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```')
    expect(result).toEqual({
      lang: 'mermaid',
      code: 'flowchart TD\n  A[开始] --> B[结束]',
      title: ''
    })
  })
})

describe('renderDiagram', () => {
  it('renders a fallback card for languages that are not yet rendered', async () => {
    const rendered = await renderDiagram('```markmap\n- A\n- B\n```')
    expect(rendered.node.className).toBe('desk-diagram__fallback')
    expect(rendered.node.textContent).toContain('markmap')
  })

  it('does not throw when mermaid layout is not available (test env)', async () => {
    const rendered = await renderDiagram('```mermaid\nflowchart TD\n  A --> B\n```')
    expect(['desk-diagram__svg', 'desk-diagram__error']).toContain(rendered.node.className)
  })

  it('renders a host node for a mindmap fence (canvas needs a real browser)', async () => {
    const rendered = await renderDiagram('```mindmap\n- 前端\n- 后端\n```')
    expect(['desk-diagram__mindmap', 'desk-diagram__error']).toContain(rendered.node.className)
  })
})
