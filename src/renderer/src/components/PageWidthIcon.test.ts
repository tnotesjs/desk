// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PageWidthIcon from './PageWidthIcon.vue'

describe('PageWidthIcon', () => {
  it('renders distinct inward and outward arrow paths', async () => {
    const wrapper = mount(PageWidthIcon, { props: { mode: 'standard' } })
    const standardPath = wrapper.get('path').attributes('d')

    await wrapper.setProps({ mode: 'wide' })

    expect(wrapper.get('path').attributes('d')).not.toBe(standardPath)
  })
})
