// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppZoomControl from './AppZoomControl.vue'

describe('app zoom control', () => {
  it('commits a pending input when closing the panel removes the focused control', async () => {
    const wrapper = mount(AppZoomControl, { props: { modelValue: 100 } })
    await wrapper.get('input').setValue('170')
    wrapper.unmount()
    expect(wrapper.emitted('update:modelValue')).toEqual([[170]])
  })

  it('shows the current percentage and waits for blur before applying input', async () => {
    const wrapper = mount(AppZoomControl, { props: { modelValue: 120 } })
    const input = wrapper.get('input')
    expect(input.element.value).toBe('120')
    expect(wrapper.find('small').exists()).toBe(false)
    expect(input.attributes('aria-describedby')).toBeUndefined()
    await input.setValue('135')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await input.trigger('blur')
    expect(wrapper.emitted('update:modelValue')).toEqual([[135]])
    wrapper.unmount()
  })

  it.each(['', ' ', 'abc', '100px', '100abc', 'Infinity', 'NaN', '1e2', '0x64', '1,00'])(
    'ignores invalid input %j and restores the current percentage',
    async (value) => {
      const wrapper = mount(AppZoomControl, { props: { modelValue: 120 } })
      const input = wrapper.get('input')
      await input.setValue(value)
      await input.trigger('blur')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(input.element.value).toBe('120')
      wrapper.unmount()
    }
  )

  it.each([
    ['-10', 50],
    ['49', 50],
    ['201', 200],
    ['9999', 200],
    [' 125% ', 125],
    ['125.5', 125.5]
  ] as const)('normalizes %s to %s on blur', async (value, expected) => {
    const wrapper = mount(AppZoomControl, { props: { modelValue: 100 } })
    const input = wrapper.get('input')
    await input.setValue(value)
    await input.trigger('blur')
    expect(wrapper.emitted('update:modelValue')).toEqual([[expected]])
    expect(input.element.value).toBe(String(expected))
    wrapper.unmount()
  })

  it('steps by ten, disables boundary buttons and follows external shortcut changes', async () => {
    const wrapper = mount(AppZoomControl, { props: { modelValue: 100 } })
    await wrapper.get('[aria-label="放大应用"]').trigger('click')
    await wrapper.setProps({ modelValue: 110 })
    await wrapper.get('[aria-label="缩小应用"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[110], [100]])
    await wrapper.setProps({ modelValue: 50 })
    expect(wrapper.get('[aria-label="缩小应用"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input').element.value).toBe('50')
    await wrapper.setProps({ modelValue: 200 })
    expect(wrapper.get('[aria-label="放大应用"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input').element.value).toBe('200')
    wrapper.unmount()
  })
})
