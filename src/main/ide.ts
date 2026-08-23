import { spawn } from 'node:child_process'
import { Menu, type BrowserWindow, shell } from 'electron'

import { loadSettings } from './settings'

function ideLabel(): string {
  return loadSettings().ide === 'cursor' ? 'Cursor' : 'VSCode'
}

export async function openInConfiguredIde(targetPath: string): Promise<void> {
  const ide = loadSettings().ide
  let child: ReturnType<typeof spawn>
  if (process.platform === 'darwin') {
    const application = ide === 'cursor' ? 'Cursor' : 'Visual Studio Code'
    child = spawn('/usr/bin/open', ['-a', application, targetPath], {
      detached: true,
      stdio: 'ignore'
    })
  } else {
    const command =
      process.platform === 'win32' ? `${ide}.cmd` : ide === 'cursor' ? 'cursor' : 'code'
    child = spawn(command, [targetPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
  }
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
    child.once('error', reject)
  })
}

export function showIdeContextMenu(window: BrowserWindow, targetPath: string): void {
  const menu = Menu.buildFromTemplate([
    {
      label: `在 ${ideLabel()} 中打开`,
      click: () => void openInConfiguredIde(targetPath)
    },
    { type: 'separator' },
    {
      label: '在文件管理器中显示',
      click: () => shell.showItemInFolder(targetPath)
    }
  ])
  menu.popup({ window })
}
