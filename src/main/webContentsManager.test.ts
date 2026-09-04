import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const contents = {
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    setZoomFactor: vi.fn(),
    isDestroyed: () => false,
    loadURL: vi.fn(async () => undefined)
  }
  const view = {
    webContents: contents,
    setBackgroundColor: vi.fn(),
    setVisible: vi.fn(),
    setBounds: vi.fn()
  }
  const createView = vi.fn(function () {
    return view
  })
  return { contents, view, createView }
})
vi.mock('electron', () => ({
  WebContentsView: mocks.createView,
  session: {
    fromPartition: () => ({ setPermissionRequestHandler: vi.fn(), on: vi.fn() })
  },
  shell: {}
}))

import { scaledWebBounds, WebContentsManager } from './webContentsManager'

describe('native embedded web view app zoom', () => {
  it.each([0.5, 1, 1.1, 2])('converts CSS bounds to native coordinates at %sx', (factor) => {
    expect(scaledWebBounds({ x: 200, y: 120, width: 700, height: 400 }, factor)).toEqual({
      x: Math.round(200 * factor),
      y: Math.round(120 * factor),
      width: Math.round(700 * factor),
      height: Math.round(400 * factor)
    })
  })

  it('zooms the main window and existing/new web views and restores zoom after navigation', async () => {
    const manager = new WebContentsManager()
    const mainContents = { setZoomFactor: vi.fn() }
    manager.attachWindow({
      on: vi.fn(),
      isDestroyed: () => false,
      webContents: mainContents,
      contentView: { addChildView: vi.fn() }
    } as unknown as Electron.BrowserWindow)
    manager.setZoomFactor(1.5)
    expect(mainContents.setZoomFactor).toHaveBeenLastCalledWith(1.5)
    await manager.create('web-test', 'https://example.com')
    expect(mocks.createView).toHaveBeenLastCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({ zoomFactor: 1.5 })
      })
    )
    manager.setZoomFactor(2)
    expect(mocks.contents.setZoomFactor).toHaveBeenLastCalledWith(2)
    const onLoaded = mocks.contents.on.mock.calls.find(([name]) => name === 'did-finish-load')?.[1]
    onLoaded()
    expect(mocks.contents.setZoomFactor).toHaveBeenLastCalledWith(2)
    manager.layout('web-test', true, { x: 200, y: 120, width: 500, height: 300 })
    expect(mocks.view.setBounds).toHaveBeenLastCalledWith({
      x: 400,
      y: 240,
      width: 1000,
      height: 600
    })
  })
})

it('includes the native web tab origin when forwarding numbered tab shortcuts', async () => {
  mocks.contents.on.mockClear()
  const manager = new WebContentsManager()
  manager.attachWindow({
    on: vi.fn(),
    isDestroyed: () => false,
    contentView: { addChildView: vi.fn() }
  } as unknown as Electron.BrowserWindow)
  const listener = vi.fn()
  manager.onTabShortcut(listener)
  await manager.create('right-web-tab', 'https://example.com')
  const onInput = mocks.contents.on.mock.calls.find(([name]) => name === 'before-input-event')?.[1]
  const event = { preventDefault: vi.fn() }
  onInput(event, {
    type: 'keyDown',
    key: '3',
    meta: process.platform === 'darwin',
    control: process.platform !== 'darwin',
    alt: false,
    shift: false,
    isComposing: false
  })
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(listener).toHaveBeenCalledExactlyOnceWith({
    type: 'activate-tab-by-number',
    number: 3,
    sourceTabId: 'right-web-tab'
  })
})
