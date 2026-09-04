import { ref, type Ref } from 'vue'

import type { useEditorStore } from '../editor'

import type { AppSettings } from '../../../../shared/contracts'
import { clampAppZoom, APP_ZOOM_DEFAULT, APP_ZOOM_STEP } from '../../../../shared/appZoom'

import { resultValue } from './helpers'

export interface SettingsContext {
  editor: ReturnType<typeof useEditorStore>
  settings: Ref<AppSettings | null>
}

export function createSettings(ctx: SettingsContext) {
  let writeQueue: Promise<unknown> = Promise.resolve()
  let zoomRevision = 0
  let confirmedZoom = APP_ZOOM_DEFAULT
  const zoomFeedbackSequence = ref(0)

  function updateSettings(next: Partial<AppSettings>): Promise<AppSettings> {
    const revision = zoomRevision
    const writing = writeQueue.then(async () => {
      const updated = resultValue(await window.desk.settings.update(next))
      confirmedZoom = updated.appZoomPercent
      // A slow settings response must not undo more recent keyboard/button input.
      const visible =
        revision !== zoomRevision && ctx.settings.value
          ? { ...updated, appZoomPercent: ctx.settings.value.appZoomPercent }
          : updated
      ctx.settings.value = visible
      ctx.editor.configure(visible)
      return updated
    })
    writeQueue = writing.catch(() => undefined)
    return writing
  }

  function applySettings(next: AppSettings): void {
    confirmedZoom = next.appZoomPercent
    ctx.settings.value = next
    ctx.editor.configure(next)
  }

  async function setAppZoom(value: number): Promise<void> {
    if (!ctx.settings.value || !Number.isFinite(value)) return
    zoomFeedbackSequence.value += 1
    const appZoomPercent = clampAppZoom(value)
    if (appZoomPercent === ctx.settings.value.appZoomPercent) return
    const revision = ++zoomRevision
    ctx.settings.value = { ...ctx.settings.value, appZoomPercent }
    try {
      await updateSettings({ appZoomPercent })
    } catch (cause) {
      if (revision === zoomRevision && ctx.settings.value) {
        ctx.settings.value = { ...ctx.settings.value, appZoomPercent: confirmedZoom }
      }
      throw cause
    }
  }

  function adjustAppZoom(direction: -1 | 1): Promise<void> {
    const current = ctx.settings.value?.appZoomPercent ?? APP_ZOOM_DEFAULT
    return setAppZoom(current + direction * APP_ZOOM_STEP)
  }

  return { updateSettings, applySettings, setAppZoom, adjustAppZoom, zoomFeedbackSequence }
}

export type SettingsApi = ReturnType<typeof createSettings>
