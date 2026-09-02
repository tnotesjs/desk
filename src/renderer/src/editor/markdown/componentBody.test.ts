import { describe, expect, it } from 'vitest'
import {
  isBilibiliVideoSource,
  isWordListSource,
  parseBilibiliVideoSource,
  parseWordListSource,
  rebuildBilibiliVideoSource,
  rebuildWordListSource
} from './componentBody'

describe('bilibili video source', () => {
  it('parses canonical and legacy tags', () => {
    expect(parseBilibiliVideoSource('<BilibiliVideo id="BV1a" />\n')).toEqual({
      name: 'BilibiliVideo',
      id: 'BV1a',
      autoplay: false,
      muted: false,
      trailingNewline: true
    })
    expect(parseBilibiliVideoSource('<BilibiliOutsidePlayer id="BV1b" />')).toMatchObject({
      id: 'BV1b',
      autoplay: false
    })
    expect(parseBilibiliVideoSource('<B id="BV1c" />')).toMatchObject({ id: 'BV1c' })
  })

  it('parses autoplay and muted flags', () => {
    expect(
      parseBilibiliVideoSource('<BilibiliVideo id="BV1" :autoplay="true" :muted="true" />')
    ).toMatchObject({
      id: 'BV1',
      autoplay: true,
      muted: true
    })
  })

  it('rebuilds only the canonical tag and omits false flags', () => {
    expect(rebuildBilibiliVideoSource('BV1x')).toBe('<BilibiliVideo id="BV1x" />\n')
    expect(rebuildBilibiliVideoSource({ id: 'BV1x', autoplay: true, muted: true })).toBe(
      '<BilibiliVideo id="BV1x" :autoplay="true" :muted="true" />\n'
    )
  })

  it('detects bilibili sources', () => {
    expect(isBilibiliVideoSource('<BilibiliVideo id="" />\n')).toBe(true)
    expect(isBilibiliVideoSource('<NotesTable :ids="[]" />\n')).toBe(false)
  })
})

describe('word list source', () => {
  it('parses canonical and legacy tags', () => {
    expect(parseWordListSource(`<WordList :words="['a', 'b']" />\n`)).toEqual({
      name: 'WordList',
      words: ['a', 'b'],
      needSort: false,
      trailingNewline: true
    })
    expect(
      parseWordListSource(`<EnWordList :words="[\n'cancel',\n]" :needSort="true" />`)
    ).toMatchObject({
      words: ['cancel'],
      needSort: true
    })
    expect(parseWordListSource(`<E :words="['x']" />`)).toMatchObject({ words: ['x'] })
  })

  it('rebuilds canonical multiline words', () => {
    expect(rebuildWordListSource({ words: ['a', 'b'], needSort: true })).toBe(
      `<WordList :words="[\n'a',\n'b',\n]" :needSort="true" />\n`
    )
    expect(rebuildWordListSource({ words: [] })).toBe('<WordList :words="[]" />\n')
  })

  it('detects word list sources', () => {
    expect(isWordListSource('<WordList :words="[]" />\n')).toBe(true)
    expect(isWordListSource('<BilibiliVideo id="" />\n')).toBe(false)
  })
})
