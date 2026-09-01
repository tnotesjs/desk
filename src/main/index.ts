import { join } from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'

import icon from '../../resources/icon.png?asset'
import { handleAssetProtocol, registerAssetScheme } from './assetProtocol'
import { gitManager } from './gitManager'
import { registerIpc } from './ipc'
import { deskLog } from './log'
import { loadSettings } from './settings'
import { updateManager } from './updateManager'
import { previewManager } from './preview'
import { searchManager } from './searchManager'
import { TabShortcutResolver } from './tabShortcuts'
import { webContentsManager } from './webContentsManager'
import { workspaceManager } from './workspaceManager'

import { IPC_CHANNELS, type TabShortcutCommand } from '../shared/contracts'

let mainWindow: BrowserWindow | null = null
let unregisterIpc: (() => void) | null = null
let unregisterSearchRefresh: (() => void) | null = null
let searchRefreshTimer: NodeJS.Timeout | null = null
const mainTabShortcutResolver = new TabShortcutResolver()

registerAssetScheme()

function scheduleSearchRefresh(): void {
  const overview = workspaceManager.getOverview()
  gitManager.configure(workspaceManager.getGitRepositories())
  searchManager.setWorkspace(overview.path)
  if (searchRefreshTimer) clearTimeout(searchRefreshTimer)
  if (!overview.path) return
  const workspacePath = overview.path
  searchRefreshTimer = setTimeout(() => {
    searchRefreshTimer = null
    void workspaceManager
      .getSearchDocuments()
      .then((documents) => searchManager.rebuild(workspacePath, documents))
      .catch((error) =>
        deskLog(
          'search',
          'document collection failed',
          error instanceof Error ? error.message : String(error)
        )
      )
  }, 350)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function sendTabShortcut(window: BrowserWindow, command: TabShortcutCommand): void {
  if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.tabShortcut, command)
}

function configureApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }
  template.push(
    {
      label: 'File',
      submenu: [
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (mainWindow) sendTabShortcut(mainWindow, 'close-active-tab-or-window')
          }
        },
        {
          label: 'Next Tab',
          accelerator: 'Ctrl+Tab',
          click: () => {
            if (mainWindow) sendTabShortcut(mainWindow, 'next-tab')
          }
        },
        {
          label: 'Previous Tab',
          accelerator: 'Ctrl+Shift+Tab',
          click: () => {
            if (mainWindow) sendTabShortcut(mainWindow, 'previous-tab')
          }
        },
        ...(process.platform === 'darwin'
          ? []
          : ([
              { type: 'separator' },
              { role: 'quit' }
            ] satisfies Electron.MenuItemConstructorOptions[]))
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 12, y: 15 }
        }
      : {}),
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
  webContentsManager.onTabShortcut((command) => sendTabShortcut(window, command))
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url === current) return
    event.preventDefault()
    if (isHttpUrl(url)) void shell.openExternal(url)
  })
  window.webContents.on('before-input-event', (event, input) => {
    const resolution = mainTabShortcutResolver.resolve(input)
    if (!resolution.handled) return
    event.preventDefault()
    if (resolution.command) sendTabShortcut(window, resolution.command)
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
    configureApplicationMenu()
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    await workspaceManager.initialize()
    unregisterSearchRefresh = workspaceManager.onChanged(scheduleSearchRefresh)
    scheduleSearchRefresh()
    handleAssetProtocol()
    unregisterIpc = registerIpc(() => mainWindow)
    updateManager.configure(loadSettings().updates.autoCheck)
    updateManager.start()
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
  if (searchRefreshTimer) clearTimeout(searchRefreshTimer)
  searchRefreshTimer = null
  unregisterSearchRefresh?.()
  unregisterSearchRefresh = null
  unregisterIpc?.()
  unregisterIpc = null
  updateManager.stop()
  void workspaceManager.dispose()
  void searchManager.dispose()
  void gitManager.dispose()
  webContentsManager.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
