// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FormatIcon from '../editor-groups/FormatIcon.vue'
import { menuIconFor } from '../markdown/slashMenu'
import { formatIcons, formatIconSvg, type FormatIconName } from './formatIcons'

describe('shared formatting icons', () => {
  it.each(Object.keys(formatIcons) as FormatIconName[])(
    '%s uses the same paths and viewBox in Vue and slash menus',
    (name) => {
      const toolbar = mount(FormatIcon, { props: { name } })
      const holder = document.createElement('div')
      holder.innerHTML = formatIconSvg(name)
      const slash = holder.querySelector('svg')!
      expect(toolbar.get('svg').attributes('viewBox')).toBe(slash.getAttribute('viewBox'))
      expect(
        toolbar.findAll('path').map((path) => [path.attributes('d'), path.attributes('fill')])
      ).toEqual(
        [...slash.querySelectorAll('path')].map((path) => [
          path.getAttribute('d'),
          path.getAttribute('fill')
        ])
      )
      expect(slash.getAttribute('stroke')).toBe('none')
      toolbar.unmount()
    }
  )

  it('also aligns the TNotes code-block shortcut icon', () => {
    expect(menuIconFor('code')).toBe(formatIconSvg('code-block'))
  })
})
