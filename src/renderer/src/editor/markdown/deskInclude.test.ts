import { describe, expect, it } from 'vitest'

import {
  bodyHasIncludeLines,
  expandIncludeLinesToFences,
  includeLanguage,
  includeTabTitle,
  parseCodeGroupEntries,
  parseDeskIncludeLine,
  serializeCodeGroupEntries,
  withCodeGroupEntryHighlights,
  withCodeGroupEntryLanguage,
  withCodeGroupEntryTitle
} from './deskInclude'

describe('parseDeskIncludeLine', () => {
  it('parses path with optional title and lang', () => {
    expect(parseDeskIncludeLine('<<< ./solutions/1/1.js [js]')).toEqual({
      path: './solutions/1/1.js',
      title: 'js',
      lang: undefined
    })
    expect(parseDeskIncludeLine("<<< './shared.md' {md}")).toEqual({
      path: './shared.md',
      title: undefined,
      lang: 'md'
    })
    expect(parseDeskIncludeLine('<<< ./a.js {js} [Solution]')).toEqual({
      path: './a.js',
      title: 'Solution',
      lang: 'js'
    })
  })

  it('strips region / highlight suffixes from the path', () => {
    expect(parseDeskIncludeLine('<<< ./file.js#region')).toEqual({
      path: './file.js',
      title: undefined,
      lang: undefined
    })
    expect(parseDeskIncludeLine('<<< ./file.js{1,2}')).toEqual({
      path: './file.js',
      title: undefined,
      lang: undefined
    })
  })

  it('rejects non-include lines', () => {
    expect(parseDeskIncludeLine('```js')).toBeNull()
    expect(parseDeskIncludeLine('<<<')).toBeNull()
  })
})

describe('include helpers', () => {
  it('derives tab title and language from the path', () => {
    expect(includeTabTitle({ path: './demos/17/1.js' })).toBe('1.js')
    expect(includeTabTitle({ path: './a.js', title: 'A' })).toBe('A')
    expect(includeLanguage({ path: './demos/17/package.json' })).toBe('json')
    expect(includeLanguage({ path: './x', lang: 'ts' })).toBe('ts')
  })

  it('expands include lines into fenced code blocks', () => {
    const body = ['<<< ./demos/17/1.js', '', '<<< ./demos/17/2.js [two]'].join('\n')
    expect(bodyHasIncludeLines(body)).toBe(true)
    const expanded = expandIncludeLinesToFences(body, (path) => {
      if (path.endsWith('1.js')) return 'export const a = 1\n'
      return 'export const b = 2\n'
    })
    expect(expanded).toContain('```js [1.js]')
    expect(expanded).toContain('export const a = 1')
    expect(expanded).toContain('```js [two]')
    expect(expanded).toContain('export const b = 2')
  })

  it('parses mixed <<< and inline fences in order', () => {
    const body = [
      '<<< ./demos/17/1.js',
      '',
      '```js [inline.js]',
      'const x = 1',
      '```',
      '',
      '<<< ./demos/17/2.js [two]'
    ].join('\n')
    const entries = parseCodeGroupEntries(body)
    expect(entries.map((entry) => entry.kind)).toEqual(['include', 'fence', 'include'])
    expect(entries[1]).toMatchObject({
      kind: 'fence',
      filename: 'inline.js',
      lang: 'js',
      code: 'const x = 1',
      highlights: ''
    })
    const serialized = serializeCodeGroupEntries(entries)
    expect(serialized).toContain('<<< ./demos/17/1.js')
    expect(serialized).toContain('```js [inline.js]')
    expect(serialized).toContain('const x = 1')
    expect(serialized).toContain('<<< ./demos/17/2.js [two]')
  })

  it('parses and rewrites fence highlight ranges', () => {
    const entries = parseCodeGroupEntries('```js {1,2,3} [demo]\nconst a = 1\n```\n')
    expect(entries[0]).toMatchObject({
      kind: 'fence',
      filename: 'demo',
      highlights: '{1-3}'
    })
    const updated = withCodeGroupEntryHighlights(entries[0]!, '{1,4}')
    expect(updated).toMatchObject({
      kind: 'fence',
      highlights: '{1,4}',
      info: 'js {1,4} [demo]'
    })
  })

  it('updates title and language on fence / include entries', () => {
    const fence: ReturnType<typeof parseCodeGroupEntries>[number] = {
      kind: 'fence',
      filename: '1',
      lang: 'js',
      info: 'js [1]',
      code: 'const a = 1',
      highlights: ''
    }
    expect(withCodeGroupEntryTitle(fence, 'alpha')).toMatchObject({
      filename: 'alpha',
      info: 'js [alpha]'
    })
    expect(withCodeGroupEntryLanguage(fence, 'ts')).toMatchObject({
      lang: 'ts',
      info: 'ts [1]'
    })

    const include = parseCodeGroupEntries('<<< ./a.js')[0]!
    const renamed = withCodeGroupEntryTitle(include, 'A')
    expect(renamed).toMatchObject({
      kind: 'include',
      rawLine: '<<< ./a.js [A]'
    })
    const retargeted = withCodeGroupEntryLanguage(include, 'ts')
    expect(retargeted).toMatchObject({
      kind: 'include',
      rawLine: '<<< ./a.js {ts}'
    })
  })
})
