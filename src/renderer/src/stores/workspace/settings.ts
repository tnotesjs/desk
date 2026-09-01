import type { Ref } from 'vue'

import type { useEditorStore } from '../editor'

import type { AppSettings } from '../../../../shared/contracts'

import { resultValue } from './helpers'

export interface SettingsContext {
  editor: ReturnType<typeof useEditorStore>
  settings: Ref<AppSettings | null>
}

export function createSettings(ctx: SettingsContext) {
  async function updateSettings(next: Partial<AppSettings>): Promise<AppSettings> {
    const updated = resultValue(await window.desk.settings.update(next))
    ctx.settings.value = updated
    ctx.editor.configure(updated)
    return updated
  }

  function applySettings(next: AppSettings): void {
    ctx.settings.value = next
    ctx.editor.configure(next)
  }

  return { updateSettings, applySettings }
}

export type SettingsApi = ReturnType<typeof createSettings>
