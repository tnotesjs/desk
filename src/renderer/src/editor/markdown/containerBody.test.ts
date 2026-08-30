// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import {
  isStructuredCalloutSource,
  parseContainerSource,
  rebuildContainerSource,
  renderContainerFromSource
} from './containerBody'

describe('parseContainerSource', () => {
  it('parses a bare-titled container', () => {
    const parsed = parseContainerSource('::: details 展开查看：说明\n\n正文  \n\n:::\n')
    expect(parsed).toEqual({
      name: 'details',
      title: '展开查看：说明',
      body: '正文  ',
      hasBody: true
    })
  })

  it('parses an untitled callout and keeps body whitespace', () => {
    const parsed = parseContainerSource('::: tip\nline  one\n\ntwo\n:::\n')
    expect(parsed.name).toBe('tip')
    expect(parsed.title).toBe('')
    expect(parsed.body).toBe('line  one\n\ntwo')
    expect(parsed.hasBody).toBe(true)
  })
})

describe('rebuildContainerSource', () => {
  it('rewrites title and body while keeping colon count', () => {
    const previous = ':::: tip 💡 TIP\n\nold\n\n::::\n'
    expect(rebuildContainerSource(previous, { title: '新标题', body: '新正文' })).toBe(
      ':::: tip 新标题\n\n新正文\n\n::::\n'
    )
  })

  it('keeps an empty body shell valid', () => {
    expect(rebuildContainerSource('::: info ℹ️ INFO\n\n\n\n:::\n', { title: 'ℹ️ INFO', body: '' })).toBe(
      '::: info ℹ️ INFO\n\n\n:::\n'
    )
  })

  it('identifies structured callout names', () => {
    expect(isStructuredCalloutSource('::: tip\n\n:::\n')).toBe(true)
    expect(isStructuredCalloutSource('::: code-group\n\n:::\n')).toBe(false)
    expect(isStructuredCalloutSource('::: swiper\n\n:::\n')).toBe(false)
  })
})

describe('renderContainerFromSource', () => {
  it('renders details with the summary title and body content', () => {
    const el = renderContainerFromSource(
      '::: details 展开查看\n\n![a](https://cdn.example/a.png)\n\nsome **bold** text\n\n:::'
    )
    expect(el).toBeInstanceOf(HTMLDetailsElement)
    expect(el.querySelector('summary')?.textContent).toContain('展开查看')
    const img = el.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://cdn.example/a.png')
    expect(el.querySelector('strong')?.textContent).toBe('bold')
    expect(el.getAttribute('data-type')).toBeNull()
  })

  it('renders callouts with class and default title', () => {
    const warning = renderContainerFromSource('::: warning\ncareful\n:::')
    expect(warning.className).toBe('custom-block custom-block-warning')
    expect(warning.querySelector('.custom-block-title')?.textContent).toBe('WARNING')
  })

  it('resolves relative images through the provided resolver', () => {
    const el = renderContainerFromSource('::: swiper\n\n![1](./assets/1.png)\n\n:::', (src) => {
      return src === './assets/1.png' ? 'tnotes-asset://asset?path=1' : src
    })
    const img = el.querySelector('img')
    expect(img?.getAttribute('src')).toBe('tnotes-asset://asset?path=1')
  })

  it('sanitizes script tags in the body', () => {
    const el = renderContainerFromSource('::: tip\n<script>alert(1)</script>ok\n:::')
    expect(el.querySelector('script')).toBeNull()
    expect(el.textContent).toBe('TIPalert(1)ok')
  })

  it('renders details with a working manual toggle', () => {
    const el = renderContainerFromSource('::: details\n\ncontent\n\n:::') as HTMLDetailsElement
    expect(el.open).toBe(false)
    el.querySelector('summary')?.dispatchEvent(
      new Event('click', { bubbles: true, cancelable: true })
    )
    expect(el.open).toBe(true)
  })

  it('builds a tabbed code group with the first tab active', () => {
    const el = renderContainerFromSource(
      [
        '::: code-group',
        '```html [App.vue]',
        '<div></div>',
        '```',
        '',
        '```js [main.js]',
        'const x = 1',
        '```',
        ':::'
      ].join('\n')
    )
    const tabs = Array.from(el.querySelectorAll('.code-group-tab'))
    expect(tabs).toHaveLength(2)
    expect(tabs[0].classList.contains('active')).toBe(true)
    expect(tabs[1].classList.contains('active')).toBe(false)
    expect(tabs[0].textContent).toBe('App.vue')
    expect(tabs[1].textContent).toBe('main.js')
    const panels = Array.from(el.querySelectorAll('.code-group-panel'))
    expect(panels).toHaveLength(2)
    expect(panels[0].classList.contains('active')).toBe(true)
    expect(panels[1].classList.contains('active')).toBe(false)
    // Clicking the second tab switches the active panel.
    tabs[1].dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
    expect(panels[1].classList.contains('active')).toBe(true)
    expect(panels[0].classList.contains('active')).toBe(false)
  })
})
