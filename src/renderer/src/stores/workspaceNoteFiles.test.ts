// @vitest-environment happy-dom

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEditorStore } from './editor'
import { useWorkspaceStore } from './workspace'
import { noteFileKey } from './workspace/helpers'

import type { DeskApi, NoteFileSaveTextRequest, NoteTextFileDto } from '../../../shared/contracts'

function file(content: string, revision: string): NoteTextFileDto {
  return {
    knowledgeBaseId: 'kb-a',
    noteUuid: 'note-a',
    path: 'demos/17/1.js',
    content,
    revision,
    size: content.length,
    readOnly: false
  }
}

describe('workspace note-file resources', () => {
  const save = vi.fn()
  const deleteRecovery = vi.fn(async () => ({ ok: true, value: undefined }) as const)

  beforeEach(() => {
    setActivePinia(createPinia())
    save.mockReset()
    deleteRecovery.mockClear()
    Object.defineProperty(window, 'desk', {
      configurable: true,
      value: {
        noteFiles: {
          readText: vi.fn(async () => ({ ok: true, value: file('const n = 1\n', 'rev-1') })),
          saveText: save
        },
        recovery: { delete: deleteRecovery }
      } as unknown as DeskApi
    })
  })

  afterEach(() => Reflect.deleteProperty(window, 'desk'))

  it('normalizes include and tree paths into one dirty resource and saves by revision', async () => {
    const workspace = useWorkspaceStore()
    const editor = useEditorStore()
    await workspace.ensureNoteFile('kb-a', 'note-a', './demos/17/1.js')
    const includeKey = noteFileKey('kb-a', 'note-a', './demos/17/1.js')
    const treeKey = noteFileKey('kb-a', 'note-a', 'demos/17/1.js')
    expect(includeKey).toBe(treeKey)

    workspace.updateNoteFileContent(includeKey, 'const n = 2\n', 'A')
    expect(workspace.getNoteFileSession('kb-a', 'note-a', 'demos/17/1.js')).toMatchObject({
      content: 'const n = 2\n',
      dirty: true
    })

    save.mockImplementation(async (request: NoteFileSaveTextRequest) => ({
      ok: true,
      value: file(request.content, 'rev-2')
    }))
    await workspace.saveNoteFile(treeKey)

    expect(save).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-a',
      noteUuid: 'note-a',
      path: 'demos/17/1.js',
      content: 'const n = 2\n',
      expectedRevision: 'rev-1'
    })
    expect(workspace.getNoteFileSession('kb-a', 'note-a', 'demos/17/1.js')).toMatchObject({
      document: { revision: 'rev-2' },
      dirty: false
    })
    expect(deleteRecovery).toHaveBeenCalledWith({
      knowledgeBaseId: 'kb-a',
      noteUuid: 'note-a',
      path: 'demos/17/1.js'
    })
    expect(editor.activeTab).toBeNull()
  })
})
