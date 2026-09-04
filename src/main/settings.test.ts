import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ profile: '' }))
vi.mock('electron', () => ({ app: { getPath: () => environment.profile } }))

import { loadSettings, saveSettings, writeSettingsRaw } from './settings'

beforeEach(() => {
  environment.profile = mkdtempSync(join(tmpdir(), 'desk-zoom-settings-'))
})

afterEach(() => {
  rmSync(environment.profile, { recursive: true, force: true })
})

describe('persisted app zoom', () => {
  it('migrates the prior note-only zoom setting without keeping a second zoom level', () => {
    writeFileSync(
      join(environment.profile, '.tn-desk-config.json'),
      JSON.stringify({
        theme: 'dark',
        noteZoomPercent: 130
      })
    )
    expect(loadSettings()).toMatchObject({ theme: 'dark', appZoomPercent: 130 })
    const saved = saveSettings({ appZoomPercent: 140 })
    expect(saved.appZoomPercent).toBe(140)
    expect(saved).not.toHaveProperty('noteZoomPercent')
  })
  it('defaults new and existing profiles to 100 without resetting other preferences', () => {
    expect(loadSettings().appZoomPercent).toBe(100)
    writeFileSync(
      join(environment.profile, '.tn-desk-config.json'),
      JSON.stringify({ theme: 'dark' })
    )
    expect(loadSettings()).toMatchObject({ theme: 'dark', appZoomPercent: 100 })
  })

  it('persists zoom, clamps bounds, and preserves zoom during unrelated updates', () => {
    expect(saveSettings({ appZoomPercent: 135 }).appZoomPercent).toBe(135)
    expect(loadSettings().appZoomPercent).toBe(135)
    expect(saveSettings({ theme: 'dark' }).appZoomPercent).toBe(135)
    expect(saveSettings({ appZoomPercent: 0 }).appZoomPercent).toBe(50)
    expect(saveSettings({ appZoomPercent: 300 }).appZoomPercent).toBe(200)
    expect(writeSettingsRaw('{"appZoomPercent": 240}').appZoomPercent).toBe(200)
  })

  it('rejects nonnumeric and nonfinite updates without changing the saved settings', () => {
    saveSettings({ appZoomPercent: 120 })
    const path = join(environment.profile, '.tn-desk-config.json')
    const before = readFileSync(path, 'utf8')
    for (const value of ['invalid', null, Infinity, NaN]) {
      expect(() => saveSettings({ appZoomPercent: value as number })).toThrow()
      expect(readFileSync(path, 'utf8')).toBe(before)
    }
  })
})
