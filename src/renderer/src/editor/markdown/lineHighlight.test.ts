import { describe, expect, it } from 'vitest'

import {
  applyFenceHighlights,
  buildFenceInfo,
  clampHighlightRanges,
  formatHighlightRanges,
  parseHighlightRanges,
  toggleHighlightLine
} from './lineHighlight'

describe('parseHighlightRanges', () => {
  it('parses singles, ranges, and mixed sets', () => {
    expect([...parseHighlightRanges('{1}')].sort((a, b) => a - b)).toEqual([1])
    expect([...parseHighlightRanges('{1,2}')].sort((a, b) => a - b)).toEqual([1, 2])
    expect([...parseHighlightRanges('{1-3}')].sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect([...parseHighlightRanges('{1,2,5-7}')].sort((a, b) => a - b)).toEqual([1, 2, 5, 6, 7])
  })

  it('extracts the brace block from fuller fence meta', () => {
    expect([...parseHighlightRanges('ts {30-51} [TypeScript]')].slice(0, 3)).toEqual([30, 31, 32])
    expect(parseHighlightRanges('')).toEqual(new Set())
    expect(parseHighlightRanges('js [App]')).toEqual(new Set())
  })
})

describe('formatHighlightRanges', () => {
  it('merges consecutive lines into ranges', () => {
    expect(formatHighlightRanges(new Set([1, 2, 3]))).toBe('{1-3}')
    expect(formatHighlightRanges(new Set([1, 2, 7]))).toBe('{1-2,7}')
    expect(formatHighlightRanges(new Set([7, 1, 3, 2]))).toBe('{1-3,7}')
    expect(formatHighlightRanges(new Set())).toBe('')
  })
})

describe('applyFenceHighlights', () => {
  it('rewrites or inserts highlight blocks while keeping titles', () => {
    expect(applyFenceHighlights('js {1,2} [App]', new Set([1, 2, 3]))).toBe('js {1-3} [App]')
    expect(applyFenceHighlights('ts [App]', new Set([1]))).toBe('ts {1} [App]')
    expect(applyFenceHighlights('js {1-3}', new Set())).toBe('js')
    expect(applyFenceHighlights('{1-3} [App]', new Set([2]))).toBe('{2} [App]')
  })
})

describe('toggle / clamp / buildFenceInfo', () => {
  it('toggles and clamps lines', () => {
    const once = toggleHighlightLine(new Set([1]), 2)
    expect([...once].sort((a, b) => a - b)).toEqual([1, 2])
    expect([...toggleHighlightLine(once, 1)].sort((a, b) => a - b)).toEqual([2])
    expect([...clampHighlightRanges(new Set([1, 5, 9]), 5)].sort((a, b) => a - b)).toEqual([1, 5])
  })

  it('builds combined fence info', () => {
    expect(buildFenceInfo('ts', new Set([1, 2, 3]), 'App')).toBe('ts {1-3} [App]')
    expect(buildFenceInfo('js', new Set(), '')).toBe('js')
    expect(buildFenceInfo('', new Set([1]), 'X')).toBe('{1} [X]')
  })
})
