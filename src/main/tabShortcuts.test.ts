import { describe, expect, it } from 'vitest'

import { resolveTabShortcut, TabShortcutResolver } from './tabShortcuts'

function input(overrides: Partial<Electron.Input> = {}): Electron.Input {
  return {
    type: 'keyDown',
    key: '',
    code: '',
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...overrides
  }
}

describe('tab shortcuts', () => {
  it('maps Command+W on macOS and Ctrl+W on Windows', () => {
    expect(resolveTabShortcut(input({ key: 'w', meta: true }), 'darwin')).toBe(
      'close-active-tab-or-window'
    )
    expect(resolveTabShortcut(input({ key: 'w', control: true }), 'win32')).toBe(
      'close-active-tab-or-window'
    )
    expect(resolveTabShortcut(input({ key: 'w', control: true }), 'darwin')).toBeNull()
  })

  it('cycles tabs forward and backward with Control+Tab', () => {
    expect(resolveTabShortcut(input({ key: 'Tab', control: true }), 'darwin')).toBe('next-tab')
    expect(resolveTabShortcut(input({ key: 'Tab', control: true, shift: true }), 'darwin')).toBe(
      'previous-tab'
    )
  })

  it('supports VS Code-style Command+K chords', () => {
    const resolver = new TabShortcutResolver()
    expect(resolver.resolve(input({ key: 'k', meta: true }), 'darwin', 100)).toEqual({
      handled: true,
      command: null
    })
    expect(resolver.resolve(input({ key: 'u', meta: true }), 'darwin', 200)).toEqual({
      handled: true,
      command: 'close-saved-note-tabs'
    })
    expect(resolver.resolve(input({ key: 'k', meta: true }), 'darwin', 300).handled).toBe(true)
    expect(resolver.resolve(input({ key: 'w', meta: true }), 'darwin', 400).command).toBe(
      'close-all-tabs'
    )
    expect(resolver.resolve(input({ key: 'k', meta: true }), 'darwin', 500).handled).toBe(true)
    expect(
      resolver.resolve(input({ key: 'Enter', meta: true, shift: true }), 'darwin', 600).command
    ).toBe('toggle-pin-active-tab')
  })

  it('copies and reveals the active note with VS Code platform shortcuts', () => {
    expect(resolveTabShortcut(input({ key: 'c', meta: true, alt: true }), 'darwin')).toBe(
      'copy-active-note-path'
    )
    expect(resolveTabShortcut(input({ key: 'r', meta: true, alt: true }), 'darwin')).toBe(
      'reveal-active-note-in-file-manager'
    )
    expect(resolveTabShortcut(input({ key: 'c', control: true, alt: true }), 'win32')).toBe(
      'copy-active-note-path'
    )
  })

  it('ignores key-up, composing and unrelated modified input', () => {
    expect(resolveTabShortcut(input({ type: 'keyUp', key: 'w', meta: true }), 'darwin')).toBeNull()
    expect(
      resolveTabShortcut(input({ key: 'Tab', control: true, isComposing: true }), 'darwin')
    ).toBeNull()
    expect(resolveTabShortcut(input({ key: 'Tab', control: true, alt: true }), 'darwin')).toBeNull()
  })
})
