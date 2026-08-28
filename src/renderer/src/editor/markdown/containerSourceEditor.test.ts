// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { createContainerSourceEditor } from './containerSourceEditor'

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
