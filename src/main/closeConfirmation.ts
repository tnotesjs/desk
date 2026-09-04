import { dialog, type BrowserWindow } from 'electron'

import type { TabCloseChoice } from '../shared/contracts'

export async function confirmTabClose(
  window: BrowserWindow,
  titles: string[]
): Promise<TabCloseChoice> {
  const { response } = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '未保存的更改',
    message:
      titles.length === 1
        ? `是否保存对“${titles[0]}”的更改？`
        : `是否保存这 ${titles.length} 个文件的更改？`,
    detail: `${titles.length > 1 ? `${titles.join('\n')}\n\n` : ''}如果不保存，你的更改将会丢失。`,
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
}
