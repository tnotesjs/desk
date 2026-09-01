// @vitest-environment happy-dom

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEditorStore } from './editor'
import { useWorkspaceStore } from './workspace'

import type {
  AppSettings,
  DeskApi,
  DeskResult,
  KnowledgeBaseDetail,
  NoteDocumentDto,
  NoteMutationDto,
  NoteSaveRequest
} from '../../../shared/contracts'

const autosaveSettings: AppSettings = {
  version: 1,
  theme: 'system',
  density: 'comfortable',
  defaultNoteView: 'visual',
  autosave: { enabled: true, delayMs: 50 },
  createNotePosition: 'top',
  workspaceLayout: 'kb-dir-content',
  prettier: true,
  ide: 'vscode',
  gitPath: null,
  nodePath: null,
  confirmBeforeCommit: false,
  tabs: { maxOpenCount: 10, wrap: true, autoRevealInToc: true },
  toc: {
    showNoteIndex: true,
    showNoteStatus: true,
    doneEmoji: '✅',
    undoneEmoji: '⏰',
    changesCollapsedByDefault: true
  },
  imageUpload: {
    defaultTarget: 'local',
    github: {
      repository: '',
      branch: 'main',
      path: '/',
      cdnTemplate: '',
      fileNameFormat: '${YY}-${MM}-${DD}-${HH}-${mm}-${ss}'
    }
  },
  updates: { autoCheck: true },
  hiddenKnowledgeBases: [],
  knowledgeBases: {}
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const knowledgeBase: KnowledgeBaseDetail = {
  id: 'kb-a',
  configId: 'TNotes.docs',
  name: 'TNotes.docs',
  rootPath: '/tmp/TNotes.docs',
  displayName: 'docs',
  icon: null,
  health: 'ready',
  diagnostics: [],
  noteCount: 1,
  snapshotRevision: 'snapshot-1',
  toc: []
}

function note(content: string, revision: string): NoteDocumentDto {
  return {
    knowledgeBaseId: knowledgeBase.id,
    uuid: 'note-a',
    index: '0001',
    title: 'A',
    dirName: '0001',
    directoryPath: '/tmp/TNotes.docs/notes/0001',
    readmePath: '/tmp/TNotes.docs/notes/0001/README.md',
    configPath: '/tmp/TNotes.docs/notes/0001/config.yaml',
    content,
    revision,
    config: {},
    readOnly: false
  }
}

function mutation(content: string, revision: string): DeskResult<NoteMutationDto> {
  return {
    ok: true,
    value: {
      note: note(content, revision),
      knowledgeBase: { ...knowledgeBase, snapshotRevision: `snapshot-${revision}` },
      changedFiles: []
    }
  }
}

describe('workspace document saving', () => {
  const saveRequests: NoteSaveRequest[] = []
  const pendingSaves: Array<Deferred<DeskResult<NoteMutationDto>>> = []
  const deleteRecovery = vi.fn(async () => ({ ok: true, value: undefined }) as const)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    saveRequests.length = 0
    pendingSaves.length = 0
    deleteRecovery.mockClear()

    const desk = {
      notes: {
        read: vi.fn(async () => ({ ok: true, value: note('original', 'revision-1') }) as const),
        save: vi.fn((request: NoteSaveRequest) => {
          saveRequests.push(request)
          const pending = deferred<DeskResult<NoteMutationDto>>()
          pendingSaves.push(pending)
          return pending.promise
        })
      },
      recovery: { delete: deleteRecovery }
    } as unknown as DeskApi
    Object.defineProperty(window, 'desk', { configurable: true, value: desk })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'desk')
  })

  it('retains edits made during an in-flight save and saves them against the new revision', async () => {
    const workspace = useWorkspaceStore()
    const editor = useEditorStore()
    const key = `${knowledgeBase.id}:note-a`
    await workspace.ensureDocument(knowledgeBase.id, 'note-a')
    editor.openNote(knowledgeBase, 'note-a', 'A', 'visual', undefined, 'permanent')

    workspace.updateDocumentContent(key, 'first edit', true)
    const firstSave = workspace.saveDocument(key)

    expect(saveRequests).toEqual([
      {
        knowledgeBaseId: knowledgeBase.id,
        noteUuid: 'note-a',
        content: 'first edit',
        expectedRevision: 'revision-1',
        prettier: false
      }
    ])

    workspace.updateDocumentContent(key, 'second edit', true)
    pendingSaves[0].resolve(mutation('first edit', 'revision-2'))
    await firstSave

    expect(workspace.getDocumentSession(knowledgeBase.id, 'note-a')).toMatchObject({
      document: { revision: 'revision-2', content: 'first edit' },
      content: 'second edit',
      dirty: true,
      saving: false
    })
    expect(editor.activeTab).toMatchObject({ noteUuid: 'note-a', dirty: true })
    expect(workspace.status).toBe('已保存先前修改，仍有未保存内容')
    expect(deleteRecovery).not.toHaveBeenCalled()

    const secondSave = workspace.saveDocument(key)
    expect(saveRequests[1]).toEqual({
      knowledgeBaseId: knowledgeBase.id,
      noteUuid: 'note-a',
      content: 'second edit',
      expectedRevision: 'revision-2',
      prettier: false
    })

    pendingSaves[1].resolve(mutation('second edit', 'revision-3'))
    await secondSave

    expect(workspace.getDocumentSession(knowledgeBase.id, 'note-a')).toMatchObject({
      document: { revision: 'revision-3', content: 'second edit' },
      content: 'second edit',
      dirty: false,
      saving: false
    })
    expect(editor.activeTab).toMatchObject({ noteUuid: 'note-a', dirty: false })
    expect(workspace.status).toBe('已保存')
    expect(deleteRecovery).toHaveBeenCalledOnce()
    expect(deleteRecovery).toHaveBeenCalledWith({
      knowledgeBaseId: knowledgeBase.id,
      noteUuid: 'note-a'
    })
  })

  it('leaves the configured Core formatter in control for source-mode edits', async () => {
    const workspace = useWorkspaceStore()
    const key = `${knowledgeBase.id}:note-a`
    await workspace.ensureDocument(knowledgeBase.id, 'note-a')

    workspace.updateDocumentContent(key, 'source edit')
    const saving = workspace.saveDocument(key)

    expect(saveRequests[0]).toEqual({
      knowledgeBaseId: knowledgeBase.id,
      noteUuid: 'note-a',
      content: 'source edit',
      expectedRevision: 'revision-1'
    })

    pendingSaves[0].resolve(mutation('source edit', 'revision-2'))
    await saving
  })

  it('requeues autosave when a timer fires while an earlier save is still running', async () => {
    const workspace = useWorkspaceStore()
    const key = `${knowledgeBase.id}:note-a`
    workspace.settings = autosaveSettings
    await workspace.ensureDocument(knowledgeBase.id, 'note-a')

    workspace.updateDocumentContent(key, 'first edit', true)
    const firstSave = workspace.saveDocument(key)
    workspace.updateDocumentContent(key, 'second edit', true)

    await vi.advanceTimersByTimeAsync(50)
    expect(saveRequests).toHaveLength(1)

    pendingSaves[0].resolve(mutation('first edit', 'revision-2'))
    await firstSave
    await vi.advanceTimersByTimeAsync(50)

    expect(saveRequests[1]).toMatchObject({
      content: 'second edit',
      expectedRevision: 'revision-2',
      prettier: false
    })

    pendingSaves[1].resolve(mutation('second edit', 'revision-3'))
    await vi.runAllTimersAsync()
  })
})
