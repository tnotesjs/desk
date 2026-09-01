import { readFileSync, writeFileSync } from 'node:fs'
import { dialog } from 'electron'
import { z } from 'zod'

import { gitManager } from '../gitManager'
import { validateGitHubImageSettings } from '../imageBed'
import { clearGitHubToken, imageTokenStatus, saveGitHubToken } from '../imageSecret'
import {
  importSettings,
  readSettingsFile,
  resetSettings,
  saveSettings,
  writeSettingsRaw
} from '../settings'
import { IPC_CHANNELS } from '../../shared/contracts'
import { githubImageSettingsSchema } from './schemas'
import { handle, noInputSchema, type GetWindow } from './shared'

import type { AppSettings } from '../../shared/contracts'

export function registerSettings(getWindow: GetWindow): void {
  handle(IPC_CHANNELS.settingsUpdate, getWindow, z.record(z.string(), z.unknown()), (input) => {
    const settings = saveSettings(input as Partial<AppSettings>)
    gitManager.applyAutoPushSchedules(true)
    return settings
  })
  handle(IPC_CHANNELS.settingsExport, getWindow, noInputSchema, async () => {
    const window = getWindow()
    if (!window) throw new Error('Desk 主窗口不可用')
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: '导出配置',
      defaultPath: '.tn-desk-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return
    writeFileSync(filePath, readSettingsFile(), 'utf8')
  })
  handle(IPC_CHANNELS.settingsImport, getWindow, noInputSchema, async () => {
    const window = getWindow()
    if (!window) throw new Error('Desk 主窗口不可用')
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: '导入配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePaths[0]) throw new Error('未选择配置文件')
    const settings = importSettings(readFileSync(filePaths[0], 'utf8'))
    gitManager.applyAutoPushSchedules(true)
    return settings
  })
  handle(IPC_CHANNELS.settingsReset, getWindow, noInputSchema, () => {
    const settings = resetSettings()
    gitManager.applyAutoPushSchedules(true)
    return settings
  })
  handle(IPC_CHANNELS.settingsReadRaw, getWindow, noInputSchema, () => readSettingsFile())
  handle(IPC_CHANNELS.settingsWriteRaw, getWindow, z.string(), (json) => {
    const settings = writeSettingsRaw(json)
    gitManager.applyAutoPushSchedules(true)
    return settings
  })
  handle(IPC_CHANNELS.imageTokenStatus, getWindow, noInputSchema, () => imageTokenStatus())
  handle(
    IPC_CHANNELS.imageTokenUpdate,
    getWindow,
    z.object({
      token: z.string().max(2048).optional(),
      clear: z.boolean()
    }),
    ({ token, clear }) => {
      if (clear) return clearGitHubToken()
      if (token?.trim()) return saveGitHubToken(token)
      return imageTokenStatus()
    }
  )
  handle(
    IPC_CHANNELS.imageSettingsValidate,
    getWindow,
    z.object({
      github: githubImageSettingsSchema,
      token: z.string().max(2048).optional()
    }),
    ({ github, token }) => validateGitHubImageSettings(github, token)
  )
}
