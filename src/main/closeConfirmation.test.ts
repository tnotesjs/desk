import { describe, expect, it, vi } from 'vitest'

const showMessageBox = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ dialog: { showMessageBox } }))
import { confirmTabClose } from './closeConfirmation'

describe('unsaved tab native confirmation', () => {
  it.each([
    [0, 'save'],
    [1, 'discard'],
    [2, 'cancel'],
    [-1, 'cancel']
  ] as const)('maps response %s to %s', async (response, expected) => {
    const window = {} as Electron.BrowserWindow
    showMessageBox.mockResolvedValue({ response })
    expect(await confirmTabClose(window, ['Example note'])).toBe(expected)
    expect(showMessageBox).toHaveBeenLastCalledWith(
      window,
      expect.objectContaining({
        type: 'warning',
        buttons: ['保存', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
        message: '是否保存对“Example note”的更改？',
        detail: '如果不保存，你的更改将会丢失。'
      })
    )
  })

  it('lists all affected resources in one batch confirmation', async () => {
    showMessageBox.mockResolvedValue({ response: 2 })
    await confirmTabClose({} as Electron.BrowserWindow, ['A', 'B / demo.js'])
    expect(showMessageBox).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        message: '是否保存这 2 个文件的更改？',
        detail: expect.stringContaining('A\nB / demo.js')
      })
    )
  })
})
