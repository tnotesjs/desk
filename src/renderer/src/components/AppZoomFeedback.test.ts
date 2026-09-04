// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppZoomFeedback from './AppZoomFeedback.vue'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('application zoom feedback capsule', () => {
  it('appears on zoom changes and disappears after three seconds', async () => {
    const wrapper = mount(AppZoomFeedback, { props: { percent: 100, sequence: 0 } })
    expect(wrapper.find('.app-zoom-feedback').exists()).toBe(false)
    await wrapper.setProps({ percent: 110, sequence: 1 })
    expect(wrapper.get('output').text()).toBe('110%')
    await vi.advanceTimersByTimeAsync(2999)
    expect(wrapper.find('.app-zoom-feedback').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.find('.app-zoom-feedback').exists()).toBe(false)
    wrapper.unmount()
  })

  it('stays visible while hovered and starts a fresh three-second timer on leave', async () => {
    const wrapper = mount(AppZoomFeedback, { props: { percent: 100, sequence: 0 } })
    await wrapper.setProps({ percent: 120, sequence: 1 })
    await vi.advanceTimersByTimeAsync(2000)
    await wrapper.get('.app-zoom-feedback').trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(6000)
    await wrapper.setProps({ percent: 130, sequence: 2 })
    await vi.advanceTimersByTimeAsync(6000)
    expect(wrapper.get('output').text()).toBe('130%')
    await wrapper.get('.app-zoom-feedback').trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(2999)
    expect(wrapper.find('.app-zoom-feedback').exists()).toBe(true)
    await wrapper.get('.app-zoom-feedback').trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.find('.app-zoom-feedback').exists()).toBe(true)
    await wrapper.get('.app-zoom-feedback').trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(3000)
    expect(wrapper.find('.app-zoom-feedback').exists()).toBe(false)
    wrapper.unmount()
  })

  it('restarts the timer on repeated shortcuts, including at a boundary', async () => {
    const wrapper = mount(AppZoomFeedback, { props: { percent: 200, sequence: 0 } })
    await wrapper.setProps({ sequence: 1 })
    await vi.advanceTimersByTimeAsync(2500)
    await wrapper.setProps({ sequence: 2 })
    await vi.advanceTimersByTimeAsync(2500)
    expect(wrapper.get('output').text()).toBe('200%')
    expect(wrapper.get('[aria-label="放大应用"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="缩小应用"]').trigger('click')
    await wrapper.get('[aria-label="重置应用缩放"]').trigger('click')
    expect(wrapper.emitted('decrease')).toHaveLength(1)
    expect(wrapper.emitted('reset')).toHaveLength(1)
    await wrapper.setProps({ percent: 50, sequence: 3 })
    expect(wrapper.get('[aria-label="缩小应用"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="放大应用"]').trigger('click')
    expect(wrapper.emitted('increase')).toHaveLength(1)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
