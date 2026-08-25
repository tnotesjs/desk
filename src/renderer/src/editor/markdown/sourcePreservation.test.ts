import { describe, expect, it } from 'vitest'

import {
  parseMarkdownSource,
  reconcileMarkdownSource,
  serializeMarkdownSource
} from './sourcePreservation'

describe('Markdown source preservation', () => {
  it('slices a generated title and complete TOC region as opaque raw blocks', () => {
    const source = [
      '',
      '# 0001. 标题  ',
      '',
      '<!-- region:toc -->',
      '- [1. 第一节](#1-第一节)',
      '  - [1.1. 子标题](#11-子标题)',
      '<!-- endregion:toc -->',
      '',
      '## 1. 第一节',
      ''
    ].join('\r\n')
    const document = parseMarkdownSource(source)

    expect(document.blocks.map((block) => block.kind)).toEqual([
      'raw-generated-title',
      'raw-generated-toc',
      'heading'
    ])
    expect(document.blocks.slice(0, 2).every((block) => block.raw)).toBe(true)
    expect(document.blocks[1].source).toBe(
      [
        '<!-- region:toc -->',
        '- [1. 第一节](#1-第一节)',
        '  - [1.1. 子标题](#11-子标题)',
        '<!-- endregion:toc -->'
      ].join('\r\n')
    )
    expect(serializeMarkdownSource(document)).toBe(source)
  })

  it('does not classify a later H1 or an unterminated TOC region as generated', () => {
    const source = ['intro', '', '# User heading', '', '<!-- region:toc -->', '- item'].join('\n')
    const document = parseMarkdownSource(source)

    expect(document.blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'heading',
      'html',
      'list'
    ])
    expect(document.blocks.every((block) => !block.raw)).toBe(true)
    expect(serializeMarkdownSource(document)).toBe(source)
  })

  it('slices TNotes raw constructs as top-level atoms and retains every byte', () => {
    const source = [
      '  ',
      ':::: code-group',
      '```ts [TypeScript]',
      'const value = 1',
      '```',
      '::::',
      '',
      '<<< ./assets/example.md [Example]',
      '',
      '<EnWordList :words="[',
      "'one',",
      "'two',]\" />",
      '',
      '<Footprints :times="[2026, 8, 25]">',
      '  <template #text-area>content</template>',
      '</Footprints>',
      '',
      '````md',
      '```mermaid',
      'A --> B',
      '```',
      '````',
      ''
    ].join('\r\n')
    const document = parseMarkdownSource(source)

    expect(document.blocks.map((block) => block.kind)).toEqual([
      'raw-container',
      'raw-include',
      'raw-component',
      'raw-component',
      'raw-fence'
    ])
    expect(document.blocks.every((block) => block.raw)).toBe(true)
    expect(document.blocks[0].source).toContain('```ts [TypeScript]')
    expect(document.blocks[4].source).toContain('```mermaid')
    expect(serializeMarkdownSource(document)).toBe(source)
  })

  it('reuses all original bytes when Milkdown has not changed its canonical output', () => {
    const original = '#  Title\r\n\r\n\r\n* first\r\n* second\r\n'
    const canonical = '# Title\n\n- first\n- second\n'

    expect(reconcileMarkdownSource(original, canonical, canonical)).toBe(original)
  })

  it('emits only a changed block from canonical Markdown', () => {
    const original = '#  Title\r\n\r\n\r\n*   first\r\n*   second\r\n\r\n>   quote\r\n'
    const baseline = '# Title\n\n- first\n- second\n\n> quote\n'
    const current = '# Title\n\n- first\n- changed\n\n> quote\n'

    expect(reconcileMarkdownSource(original, baseline, current)).toBe(
      '#  Title\r\n\r\n\r\n- first\n- changed\r\n\r\n>   quote\r\n'
    )
  })

  it('keeps TNotes raw atoms byte-identical when an adjacent Markdown block changes', () => {
    const original = [
      ':::: code-group',
      '````ts [TypeScript]',
      'const value = 1  ',
      '````',
      '::::',
      '',
      "<EnWordList :words=\"['one', 'two']\" />",
      '',
      'Paragraph with  hard break.  ',
      ''
    ].join('\r\n')
    const baseline = [
      ':::: code-group',
      '````ts [TypeScript]',
      'const value = 1  ',
      '````',
      '::::',
      '',
      "<EnWordList :words=\"['one', 'two']\" />",
      '',
      'Paragraph with hard break.',
      ''
    ].join('\n')
    const current = baseline.replace('Paragraph with hard break.', 'Edited paragraph.')

    expect(reconcileMarkdownSource(original, baseline, current)).toBe(
      [
        ':::: code-group',
        '````ts [TypeScript]',
        'const value = 1  ',
        '````',
        '::::',
        '',
        "<EnWordList :words=\"['one', 'two']\" />",
        '',
        'Edited paragraph.',
        ''
      ].join('\r\n')
    )
  })

  it('handles insertions and deletions without reprinting surviving blocks', () => {
    const original = 'alpha  \n\nBRAVO\n\ncharlie\t\n'
    const baseline = 'alpha\n\nBRAVO\n\ncharlie\n'

    expect(
      reconcileMarkdownSource(original, baseline, 'alpha\n\ninserted\n\nBRAVO\n\ncharlie\n')
    ).toBe('alpha  \n\ninserted\n\nBRAVO\n\ncharlie\t\n')
    expect(reconcileMarkdownSource(original, baseline, 'alpha\n\ncharlie\n')).toBe(
      'alpha  \n\ncharlie\t\n'
    )
  })

  it('preserves the original source of blocks that move', () => {
    const original = 'first  \n\nSECOND\n\nthird\t\n'
    const baseline = 'first\n\nSECOND\n\nthird\n'
    const current = 'SECOND\n\nfirst\n\nthird\n'

    expect(reconcileMarkdownSource(original, baseline, current)).toBe(
      'SECOND\n\nfirst  \n\nthird\t\n'
    )
  })

  it('matches adjacent duplicate blocks by occurrence', () => {
    const original = 'same  \n\nsame\t\n\nend\n'
    const baseline = 'same\n\nsame\n\nend\n'
    const current = 'same\n\ninserted\n\nsame\n\nend\n'

    expect(reconcileMarkdownSource(original, baseline, current)).toBe(
      'same  \n\ninserted\n\nsame\t\n\nend\n'
    )
  })

  it('slices consecutive reference definitions and continuation titles as an opaque block', () => {
    const source = [
      'See [guide] and ![logo][asset].',
      '',
      '[guide]: <https://example.com/docs> "Docs"',
      '[asset]: ./images/logo.png',
      "  'Logo title'",
      '',
      'after'
    ].join('\n')
    const document = parseMarkdownSource(source)

    expect(document.blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'raw-reference-definition',
      'paragraph'
    ])
    expect(document.blocks[1].source).toBe(
      '[guide]: <https://example.com/docs> "Docs"\n[asset]: ./images/logo.png\n  \'Logo title\''
    )
    expect(document.blocks[1].raw).toBe(true)
    expect(serializeMarkdownSource(document)).toBe(source)
  })

  it('keeps the original fence, metadata, and line endings when code content changes', () => {
    const original = [
      '# Code',
      '',
      '````ts {30-51} [TypeScript]',
      'const first = 1',
      'const second = 2',
      '````',
      ''
    ].join('\r\n')
    const baseline = ['# Code', '', '```ts', 'const first = 1', 'const second = 2', '```', ''].join(
      '\n'
    )
    const current = baseline.replace('const second = 2', 'const second = 3')

    expect(reconcileMarkdownSource(original, baseline, current)).toBe(
      original.replace('const second = 2', 'const second = 3')
    )
  })

  it('updates only the fence language token and retains the original metadata', () => {
    const original = '~~~ts {30-51} [TypeScript]\r\nconst value = 1\r\n~~~\r\n'
    const baseline = '```ts\nconst value = 1\n```\n'
    const current = '```js\nconst value = 2\n```\n'

    expect(reconcileMarkdownSource(original, baseline, current)).toBe(
      '~~~js {30-51} [TypeScript]\r\nconst value = 2\r\n~~~\r\n'
    )
  })

  it('retains a latex fence when Crepe edits it through a math node', () => {
    const original = '```latex\r\nx^2 + y^2\r\n```\r\n'
    const baseline = '$$\nx^2 + y^2\n$$\n'
    const current = '$$\nx^3 + y^3\n$$\n'

    expect(reconcileMarkdownSource(original, baseline, current)).toBe(
      '```latex\r\nx^3 + y^3\r\n```\r\n'
    )
  })
})
