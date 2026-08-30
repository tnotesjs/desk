// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import {
  createContainerSourceEditor,
  handleEmptyRawBlockBackspace
} from './containerSourceEditor'

describe('createContainerSourceEditor', () => {
  it('creates a CodeMirror editor and reports the initial value', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const handle = createContainerSourceEditor(
      host,
      '::: tip\n\nbody\n\n:::',
      () => {},
      () => {}
    )

    expect(host.querySelector('.cm-editor')).toBeTruthy()
    expect(host.querySelector('.cm-content')).toBeTruthy()
    expect(handle.getValue()).toBe('::: tip\n\nbody\n\n:::')

    handle.destroy()
    host.remove()
  })

  it('exposes focus and destroy without throwing', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const handle = createContainerSourceEditor(
      host,
      '::: tip\n\nx\n\n:::',
      () => {},
      () => {}
    )

    handle.focus()
    expect(() => handle.destroy()).not.toThrow()
    host.remove()
  })
})

describe('handleEmptyRawBlockBackspace', () => {
  it('invokes the callback for an empty container at doc start', () => {
    const onEmptyBackspace = vi.fn(() => true)
    expect(
      handleEmptyRawBlockBackspace(
        '::: tip 💡 TIP\n\n\n\n:::\n',
        { empty: true, anchor: 0 },
        1,
        onEmptyBackspace
      )
    ).toBe(true)
    expect(onEmptyBackspace).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the body still has content', () => {
    const onEmptyBackspace = vi.fn(() => true)
    expect(
      handleEmptyRawBlockBackspace(
        '::: tip\n\nkeep me\n\n:::\n',
        { empty: true, anchor: 0 },
        1,
        onEmptyBackspace
      )
    ).toBe(false)
    expect(onEmptyBackspace).not.toHaveBeenCalled()
  })

  it('does nothing when the caret is not at doc start', () => {
    const onEmptyBackspace = vi.fn(() => true)
    expect(
      handleEmptyRawBlockBackspace(
        '::: tip\n\n:::\n',
        { empty: true, anchor: 4 },
        1,
        onEmptyBackspace
      )
    ).toBe(false)
    expect(onEmptyBackspace).not.toHaveBeenCalled()
  })

  it('removes fully-cleared non-container sources', () => {
    const onEmptyBackspace = vi.fn(() => true)
    expect(
      handleEmptyRawBlockBackspace('', { empty: true, anchor: 0 }, 1, onEmptyBackspace)
    ).toBe(true)
    expect(onEmptyBackspace).toHaveBeenCalledTimes(1)
  })
})
