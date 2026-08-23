import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'

import icon from '../../resources/icon.png?asset'
import { handleAssetProtocol, registerAssetScheme } from './assetProtocol'
import { registerIpc } from './ipc'
import { deskLog } from './log'
import { previewManager } from './preview'
import { webContentsManager } from './webContentsManager'
import { workspaceManager } from './workspaceManager'

let mainWindow: BrowserWindow | null = null
let unregisterIpc: (() => void) | null = null

registerAssetScheme()

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'TNotes Desk',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false
    }
  })

  window.once('ready-to-show', () => {
    window.show()
    if (is.dev && process.env.DESK_OPEN_DEVTOOLS === '1') {
      window.webContents.openDevTools({ mode: 'bottom' })
      deskLog('desk', 'DevTools opened (dev mode)')
    }
  })
  webContentsManager.attachWindow(window)
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url === current) return
    event.preventDefault()
    if (isHttpUrl(url)) void shell.openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.tnotesjs.desk')
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    await workspaceManager.initialize()
    handleAssetProtocol()
    unregisterIpc = registerIpc(() => mainWindow)
    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
      }
    })
  })
}

app.on('before-quit', () => {
  void previewManager.stopAll()
})

app.on('will-quit', () => {
  unregisterIpc?.()
  unregisterIpc = null
  void workspaceManager.dispose()
  webContentsManager.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
