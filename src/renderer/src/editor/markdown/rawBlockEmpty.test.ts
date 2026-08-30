import { describe, expect, it } from 'vitest'
import { isEmptyRawBlockSource } from './rawBlockEmpty'

describe('isEmptyRawBlockSource', () => {
  it('treats whitespace-only source as empty', () => {
    expect(isEmptyRawBlockSource('')).toBe(true)
    expect(isEmptyRawBlockSource('   \n\n  ')).toBe(true)
  })

  it('treats container shells with blank bodies as empty', () => {
    expect(isEmptyRawBlockSource('::: tip 💡 TIP\n\n\n\n:::\n')).toBe(true)
    expect(isEmptyRawBlockSource('::: info ℹ️ INFO\n\n:::')).toBe(true)
    expect(isEmptyRawBlockSource('::: warning\n:::\n')).toBe(true)
    expect(isEmptyRawBlockSource(':::: details\n\n::::')).toBe(true)
  })

  it('does not treat containers with body text as empty', () => {
    expect(isEmptyRawBlockSource('::: tip\n\nhello\n\n:::')).toBe(false)
    expect(isEmptyRawBlockSource('::: info\n- item\n:::')).toBe(false)
  })

  it('does not treat code-group stubs as empty until fully cleared', () => {
    expect(
      isEmptyRawBlockSource('::: code-group\n\n```js [1]\n\n```\n\n```js [2]\n\n```\n\n:::\n')
    ).toBe(false)
  })

  it('treats empty code-group / swiper shells as empty', () => {
    expect(isEmptyRawBlockSource('::: code-group\n\n:::\n')).toBe(true)
    expect(isEmptyRawBlockSource('::: swiper\n\n:::\n')).toBe(true)
  })

  it('requires full clear for components and diagram fences', () => {
    expect(isEmptyRawBlockSource('<N :ids="[\n  \'\',\n]" />\n')).toBe(false)
    expect(isEmptyRawBlockSource('```mermaid\n\n```\n')).toBe(false)
    expect(isEmptyRawBlockSource('```mindmap\n\n```\n')).toBe(false)
  })

  it('rejects containers with content outside the fences', () => {
    expect(isEmptyRawBlockSource('note\n::: tip\n\n:::\n')).toBe(false)
    expect(isEmptyRawBlockSource('::: tip\n\n:::\ntrailing')).toBe(false)
  })
})
