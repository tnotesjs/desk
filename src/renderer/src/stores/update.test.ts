// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  checkForUpdates,
  dismissUpdateBanner,
  initUpdateWatcher,
  updateBanner,
  useUpdateState
} from './update'

import type { DeskResult, UpdateStatusDto } from '../../../shared/contracts'

const available: UpdateStatusDto = {
  state: 'available',
  currentVersion: '0.2.1',
  latestVersion: '0.3.0',
  releaseUrl: 'https://github.com/tnotesjs/desk/releases/tag/v0.3.0',
  checkedAt: '2026-09-01T00:00:00.000Z'
}

function ok<T>(value: T): DeskResult<T> {
  return { ok: true, value }
}

function mockDesk(
  initial: UpdateStatusDto,
  checkResult: UpdateStatusDto
): {
  desk: { updates: Record<string, ReturnType<typeof vi.fn>> }
  emit: (status: UpdateStatusDto) => void
} {
  let listener: ((status: UpdateStatusDto) => void) | null = null
  const desk = {
    updates: {
      status: vi.fn(async () => ok(initial)),
      check: vi.fn(async () => ok(checkResult)),
      openReleasePage: vi.fn(async () => ok(undefined)),
      onChanged: vi.fn((callback: (status: UpdateStatusDto) => void) => {
        listener = callback
        return () => {
          listener = null
        }
      })
    }
  }
  Object.defineProperty(window, 'desk', { configurable: true, value: desk })
  return {
    desk,
    emit: (status: UpdateStatusDto) => listener?.(status)
  }
}

describe('update store', () => {
  beforeEach(() => {
    const state = useUpdateState()
    state.status = null
    state.checking = false
    state.dismissedVersion = ''
  })

  it('shows banner when a newer version is pushed', async () => {
    const { emit } = mockDesk(
      { state: 'idle', currentVersion: '0.2.1' },
      { state: 'up-to-date', currentVersion: '0.2.1' }
    )
    const off = initUpdateWatcher()
    expect(updateBanner.value).toBeNull()
    emit(available)
    expect(updateBanner.value?.latestVersion).toBe('0.3.0')
    off()
  })

  it('hides banner after dismiss and manual check refreshes status', async () => {
    const { desk, emit } = mockDesk(available, {
      state: 'up-to-date',
      currentVersion: '0.2.1',
      latestVersion: '0.2.1',
      checkedAt: '2026-09-01T00:00:00.000Z'
    })
    const off = initUpdateWatcher()
    await vi.waitFor(() => expect(updateBanner.value?.latestVersion).toBe('0.3.0'))
    dismissUpdateBanner()
    expect(updateBanner.value).toBeNull()
    emit(available)
    expect(updateBanner.value).toBeNull()

    const result = await checkForUpdates()
    expect(desk.updates.check).toHaveBeenCalledTimes(1)
    expect(result?.state).toBe('up-to-date')
    expect(updateBanner.value).toBeNull()
    off()
  })
})
