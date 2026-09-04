import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ profile: '' }))
vi.mock('electron', () => ({ app: { getPath: () => environment.profile } }))
import { deleteRecovery, loadRecoveries, writeRecovery } from './recovery'

beforeEach(() => {
  environment.profile = mkdtempSync(join(tmpdir(), 'desk-close-recovery-'))
})
afterEach(() => rmSync(environment.profile, { recursive: true, force: true }))

describe('discarding recovery data', () => {
  it.each([undefined, 'demo.js'])(
    'does not let an in-flight snapshot resurrect discarded changes (%s)',
    async (path) => {
      const workspace = join(environment.profile, 'workspace')
      const request = {
        knowledgeBaseId: 'kb',
        noteUuid: 'note',
        path,
        title: 'Note',
        content: 'draft',
        revision: 'v1'
      }
      const write = writeRecovery(workspace, request)
      const discard = deleteRecovery(workspace, request)
      await Promise.all([write, discard])
      expect(await loadRecoveries(workspace)).toEqual([])
      await Promise.all([
        writeRecovery(workspace, request),
        writeRecovery(workspace, { ...request, content: 'latest' })
      ])
      expect(await loadRecoveries(workspace)).toMatchObject([{ content: 'latest' }])
    }
  )
})
