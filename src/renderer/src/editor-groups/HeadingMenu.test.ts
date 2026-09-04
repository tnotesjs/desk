// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HeadingMenu from './HeadingMenu.vue'

const wrappers: ReturnType<typeof mount>[] = []

function mountMenu(platform = 'darwin'): ReturnType<typeof mount> {
  const wrapper = mount(HeadingMenu, {
    attachTo: document.body,
    props: { level: 0, disabled: false, active: true, platform }
  })
  wrappers.push(wrapper)
  return wrapper
}

function options(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('heading menu', () => {
  it('opens on hover without stealing focus, bridges the menu gap and closes on mouse leave', async () => {
    vi.useFakeTimers()
    const editor = document.createElement('textarea')
    document.body.append(editor)
    editor.focus()
    const wrapper = mountMenu()
    await wrapper.get('button').trigger('mouseenter')
    expect(options()).toHaveLength(6)
    expect(document.activeElement).toBe(editor)
    await wrapper.get('button').trigger('mouseleave')
    vi.advanceTimersByTime(100)
    document.querySelector('[role="menu"]')?.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(300)
    await wrapper.vm.$nextTick()
    expect(options()).toHaveLength(6)
    document.querySelector('[role="menu"]')?.dispatchEvent(new MouseEvent('mouseleave'))
    vi.advanceTimersByTime(201)
    await wrapper.vm.$nextTick()
    expect(options()).toHaveLength(0)
    expect(document.activeElement).toBe(editor)
  })

  it('keeps a hover-opened menu open on click and dismisses hover with Escape in the editor', async () => {
    const wrapper = mountMenu()
    await wrapper.get('button').trigger('mouseenter')
    await wrapper.get('button').trigger('click')
    expect(options()).toHaveLength(6)
    expect(document.activeElement).toBe(options()[0])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    await wrapper.get('button').trigger('mouseenter')
    document.body.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(options()).toHaveLength(0)
  })
  it('offers paragraph and H2–H6 with platform shortcuts, never H1', async () => {
    const wrapper = mountMenu()
    await wrapper.get('button').trigger('click')

    expect(options().map((button) => button.getAttribute('aria-label'))).toEqual([
      '正文',
      '标题 2',
      '标题 3',
      '标题 4',
      '标题 5',
      '标题 6'
    ])
    expect(options().map((button) => button.querySelector('kbd')?.textContent)).toEqual([
      '⌥ ⌘ 0',
      '⌥ ⌘ 2',
      '⌥ ⌘ 3',
      '⌥ ⌘ 4',
      '⌥ ⌘ 5',
      '⌥ ⌘ 6'
    ])
    expect(options()[0].getAttribute('aria-checked')).toBe('true')
    options()[2].click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('select')).toEqual([[3]])
    expect(document.querySelector('[role="menu"]')).toBeNull()

    await wrapper.setProps({ level: 3, platform: 'win32' })
    expect(wrapper.get('button').text()).toBe('H3')
    await wrapper.get('button').trigger('click')
    expect(options()[2].getAttribute('aria-checked')).toBe('true')
    expect(options()[2].querySelector('kbd')?.textContent).toBe('Alt Ctrl 3')
    expect(document.activeElement).toBe(options()[2])
  })

  it('supports arrow navigation, Home/End and Escape without applying a change', async () => {
    const wrapper = mountMenu()
    await wrapper.get('button').trigger('keydown', { key: 'ArrowDown' })
    const press = (key: string): void => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }
    expect(document.activeElement).toBe(options()[0])
    press('ArrowUp')
    expect(document.activeElement).toBe(options()[5])
    press('Home')
    expect(document.activeElement).toBe(options()[0])
    press('End')
    expect(document.activeElement).toBe(options()[5])
    press('ArrowDown')
    expect(document.activeElement).toBe(options()[0])
    press('Escape')
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(wrapper.get('button').element)
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('closes on outside click, scroll and disabling, and cleans up on unmount', async () => {
    const wrapper = mountMenu()
    await wrapper.get('button').trigger('click')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(options()).toHaveLength(0)
    await wrapper.get('button').trigger('click')
    window.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(options()).toHaveLength(0)
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({ disabled: true })
    expect(options()).toHaveLength(0)
    await wrapper.get('button').trigger('click')
    expect(options()).toHaveLength(0)
    await wrapper.setProps({ disabled: false })
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({ active: false })
    expect(options()).toHaveLength(0)
    await wrapper.setProps({ active: true })
    await wrapper.get('button').trigger('click')
    wrapper.unmount()
    expect(options()).toHaveLength(0)
  })
})
