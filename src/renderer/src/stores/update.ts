import { computed, reactive } from 'vue'

import type { UpdateStatusDto } from '../../../shared/contracts'

interface UpdateStoreState {
  status: UpdateStatusDto | null
  checking: boolean
  dismissedVersion: string
}

const state = reactive<UpdateStoreState>({
  status: null,
  checking: false,
  dismissedVersion: ''
})

function applyStatus(status: UpdateStatusDto): void {
  state.status = status
  if (status.state !== 'checking') state.checking = false
}

export function initUpdateWatcher(): () => void {
  void window.desk.updates.status().then((result) => {
    if (result.ok) applyStatus(result.value)
  })
  return window.desk.updates.onChanged(applyStatus)
}

export async function checkForUpdates(): Promise<UpdateStatusDto | null> {
  if (state.checking) return state.status
  state.checking = true
  const result = await window.desk.updates.check()
  if (!result.ok) {
    state.checking = false
    state.status = { state: 'error', currentVersion: '', message: result.error.message }
    return null
  }
  applyStatus(result.value)
  return result.value
}

export async function openReleasePage(): Promise<void> {
  await window.desk.updates.openReleasePage()
}

export function dismissUpdateBanner(): void {
  if (state.status?.latestVersion) state.dismissedVersion = state.status.latestVersion
}

export const updateBanner = computed<UpdateStatusDto | null>(() => {
  const status = state.status
  if (!status || status.state !== 'available' || !status.latestVersion) return null
  return status.latestVersion === state.dismissedVersion ? null : status
})

export function useUpdateState(): UpdateStoreState {
  return state
}
