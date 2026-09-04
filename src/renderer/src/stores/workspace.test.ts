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
  NoteFileSaveTextRequest,
  NoteMutationDto,
  NoteRenameRequest,
  NoteSaveRequest,
  NoteTextFileDto
} from '../../../shared/contracts'
import { noteFileKey } from './workspace/helpers'

const autosaveSettings: AppSettings = {
  version: 1,
  theme: 'system',
  density: 'comfortable',
  defaultNoteView: 'visual',
  defaultNotePageWidth: 'standard',
  noteTocDisplay: 'expanded',
  appZoomPercent: 100,
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

describe('inline note rename', () => {
  const save = vi.fn()
  const rename = vi.fn()
  const recoveryWrite = vi.fn()
  const key = 'kb-a:note-a'

  function renamed(title = 'Renamed'): DeskResult<NoteMutationDto> {
    return {
      ok: true,
      value: {
        note: { ...note('renamed Markdown', 'v3'), title },
        knowledgeBase,
        changedFiles: []
      }
    }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    save
      .mockReset()
      .mockImplementation(async (request: NoteSaveRequest) => mutation(request.content, 'v2'))
    rename
      .mockReset()
      .mockImplementation(async (request: NoteRenameRequest) => renamed(request.title))
    recoveryWrite.mockReset().mockResolvedValue({ ok: true, value: undefined })
    Object.defineProperty(window, 'desk', {
      configurable: true,
      value: {
        notes: {
          read: vi.fn(async () => ({ ok: true, value: note('disk note', 'v1') })),
          save,
          rename
        },
        recovery: {
          write: recoveryWrite,
          delete: vi.fn(async () => ({ ok: true, value: undefined }))
        }
      }
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'desk')
  })

  async function setup(): Promise<{
    workspace: ReturnType<typeof useWorkspaceStore>
    editor: ReturnType<typeof useEditorStore>
  }> {
    const workspace = useWorkspaceStore()
    workspace.applySettings({ ...autosaveSettings, autosave: { enabled: false, delayMs: 50 } })
    await workspace.ensureDocument('kb-a', 'note-a')
    const editor = useEditorStore()
    editor.openNote(knowledgeBase, 'note-a', 'A', 'visual', undefined, 'permanent')
    editor.openNoteFile(knowledgeBase, 'note-a', 'A', 'demo.js', 'text')
    return { workspace, editor }
  }

  it('saves existing drafts, keeps the index immutable and synchronizes note/file tab titles', async () => {
    const { workspace, editor } = await setup()
    workspace.updateDocumentContent(key, 'unsaved draft')
    await workspace.renameNote('kb-a', 'note-a', '  Renamed  ')
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ content: 'unsaved draft', expectedRevision: 'v1' })
    )
    expect(rename).toHaveBeenCalledExactlyOnceWith({
      knowledgeBaseId: 'kb-a',
      noteUuid: 'note-a',
      title: 'Renamed',
      expectedRevision: 'v2'
    })
    expect(workspace.documents[key]).toMatchObject({
      document: { title: 'Renamed', index: '0001' },
      content: 'renamed Markdown',
      dirty: false
    })
    expect(editor.activeGroup?.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'note', title: 'Renamed', dirty: false }),
        expect.objectContaining({ type: 'note-file', noteTitle: 'Renamed' })
      ])
    )
  })

  it('preserves edits made during rename and resumes autosave using the new revision', async () => {
    const { workspace } = await setup()
    workspace.applySettings(autosaveSettings)
    const result = deferred<DeskResult<NoteMutationDto>>()
    rename.mockReturnValue(result.promise)
    const pending = workspace.renameNote('kb-a', 'note-a', 'Renamed')
    await vi.advanceTimersByTimeAsync(0)
    workspace.updateDocumentContent(key, 'typed during rename', true)
    await vi.advanceTimersByTimeAsync(100)
    expect(save).not.toHaveBeenCalled()
    result.resolve(renamed())
    await pending
    expect(workspace.documents[key]).toMatchObject({
      content: 'typed during rename',
      dirty: true,
      document: { title: 'Renamed', revision: 'v3' }
    })
    expect(recoveryWrite).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Renamed', content: 'typed during rename', revision: 'v3' })
    )
    await vi.advanceTimersByTimeAsync(50)
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'typed during rename',
        expectedRevision: 'v3',
        prettier: false
      })
    )
  })

  it('still renames the original note when the user changes knowledge bases during the request', async () => {
    const { workspace } = await setup()
    const result = deferred<DeskResult<NoteMutationDto>>()
    rename.mockReturnValue(result.promise)
    const pending = workspace.renameNote('kb-a', 'note-a', 'Renamed')
    await vi.advanceTimersByTimeAsync(0)
    workspace.selectedKnowledgeBaseId = 'kb-b'
    workspace.knowledgeBase = { ...knowledgeBase, id: 'kb-b' }
    result.resolve(renamed())
    await pending
    expect(workspace.knowledgeBase.id).toBe('kb-b')
    expect(workspace.documents[key].document.title).toBe('Renamed')
  })

  it('does not rename if saving the draft fails', async () => {
    const { workspace } = await setup()
    workspace.updateDocumentContent(key, 'unsaved draft')
    save.mockRejectedValue(new Error('保存失败'))
    await expect(workspace.renameNote('kb-a', 'note-a', 'Renamed')).rejects.toThrow('保存失败')
    expect(rename).not.toHaveBeenCalled()
    expect(workspace.documents[key]).toMatchObject({
      document: { title: 'A' },
      content: 'unsaved draft',
      dirty: true
    })
  })
})

describe('workspace unsaved tab close integration', () => {
  const confirm = vi.fn()
  const save = vi.fn()
  const saveFile = vi.fn()
  const recoveryWrite = vi.fn(async () => ({ ok: true, value: undefined }))
  const recoveryDelete = vi.fn(async () => ({ ok: true, value: undefined }))
  const file = (content = 'disk file', revision = 'v1'): NoteTextFileDto => ({
    knowledgeBaseId: knowledgeBase.id,
    noteUuid: 'note-a',
    path: 'demo.js',
    content,
    revision,
    size: content.length,
    readOnly: false
  })
  const key = `${knowledgeBase.id}:note-a`
  const fileKey = noteFileKey(knowledgeBase.id, 'note-a', 'demo.js')

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    confirm.mockReset().mockResolvedValue({ ok: true, value: 'cancel' })
    save
      .mockReset()
      .mockImplementation(async (request: NoteSaveRequest) => mutation(request.content, 'v2'))
    saveFile.mockReset().mockImplementation(async (request: NoteFileSaveTextRequest) => ({
      ok: true,
      value: file(request.content, 'v2')
    }))
    recoveryWrite.mockClear()
    recoveryDelete.mockClear()
    Object.defineProperty(window, 'desk', {
      configurable: true,
      value: {
        app: { confirmTabClose: confirm },
        notes: { read: vi.fn(async () => ({ ok: true, value: note('disk note', 'v1') })), save },
        noteFiles: {
          readText: vi.fn(async () => ({ ok: true, value: file() })),
          saveText: saveFile
        },
        recovery: { write: recoveryWrite, delete: recoveryDelete }
      }
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    Reflect.deleteProperty(window, 'desk')
  })

  async function openDraft(autosave = true): Promise<{
    workspace: ReturnType<typeof useWorkspaceStore>
    editor: ReturnType<typeof useEditorStore>
    tab: string
  }> {
    const workspace = useWorkspaceStore()
    workspace.applySettings({ ...autosaveSettings, autosave: { enabled: autosave, delayMs: 50 } })
    await workspace.ensureDocument(knowledgeBase.id, 'note-a')
    const editor = useEditorStore()
    const tab = editor.openNote(knowledgeBase, 'note-a', 'A', 'visual', undefined, 'permanent')
    workspace.updateDocumentContent(key, 'unsaved draft')
    return { workspace, editor, tab }
  }

  it('discards the document and pending snapshots without an autosave writing it back', async () => {
    const { workspace, editor, tab } = await openDraft()
    confirm.mockResolvedValue({ ok: true, value: 'discard' })
    expect(await workspace.requestCloseTab(tab)).toBe(true)
    await vi.runAllTimersAsync()
    expect(editor.activeTab).toBeNull()
    expect(workspace.getDocumentSession(knowledgeBase.id, 'note-a')).toMatchObject({
      content: 'disk note',
      dirty: false
    })
    expect(save).not.toHaveBeenCalled()
    expect(recoveryWrite).not.toHaveBeenCalled()
    expect(recoveryDelete).toHaveBeenCalledWith({
      knowledgeBaseId: knowledgeBase.id,
      noteUuid: 'note-a'
    })
    await workspace.ensureDocument(knowledgeBase.id, 'note-a')
    expect(workspace.getDocumentSession(knowledgeBase.id, 'note-a')?.content).toBe('disk note')
  })

  it('pauses autosave while deciding and resumes it after cancel', async () => {
    const { workspace, editor, tab } = await openDraft()
    const decision = deferred<DeskResult<'cancel'>>()
    confirm.mockReturnValue(decision.promise)
    const closing = workspace.requestCloseTab(tab)
    await vi.advanceTimersByTimeAsync(100)
    expect(confirm).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
    decision.resolve({ ok: true, value: 'cancel' })
    expect(await closing).toBe(false)
    expect(editor.activeTab).toMatchObject({ id: tab, dirty: true })
    await vi.advanceTimersByTimeAsync(50)
    expect(save).toHaveBeenCalledOnce()
    expect(editor.activeTab).toMatchObject({ id: tab, dirty: false })
  })

  it('awaits a pending save instead of treating a skipped duplicate save as success', async () => {
    const { workspace, editor, tab } = await openDraft(false)
    const pending = deferred<DeskResult<NoteMutationDto>>()
    save.mockReturnValue(pending.promise)
    const saving = workspace.saveDocument(key)
    const closing = workspace.requestCloseTab(tab)
    await vi.advanceTimersByTimeAsync(0)
    expect(editor.activeTab?.id).toBe(tab)
    expect(confirm).not.toHaveBeenCalled()
    pending.resolve(mutation('unsaved draft', 'v2'))
    await saving
    expect(await closing).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(editor.activeTab).toBeNull()
  })

  it('includes dirty referenced files in a README close and saves each resource once', async () => {
    const { workspace, editor, tab } = await openDraft(false)
    await workspace.ensureNoteFile(knowledgeBase.id, 'note-a', 'demo.js')
    workspace.updateNoteFileContent(fileKey, 'unsaved file')
    confirm.mockResolvedValue({ ok: true, value: 'save' })
    expect(await workspace.requestCloseTab(tab)).toBe(true)
    expect(confirm).toHaveBeenCalledWith(['A', 'A / demo.js'])
    expect(save).toHaveBeenCalledOnce()
    expect(saveFile).toHaveBeenCalledExactlyOnceWith({
      knowledgeBaseId: knowledgeBase.id,
      noteUuid: 'note-a',
      path: 'demo.js',
      content: 'unsaved file',
      expectedRevision: 'v1'
    })
    expect(workspace.getNoteFileSession(knowledgeBase.id, 'note-a', 'demo.js')).toMatchObject({
      content: 'unsaved file',
      dirty: false
    })
    expect(editor.activeTab).toBeNull()
    await vi.runAllTimersAsync()
  })

  it('discards a file tab without discarding the dirty README', async () => {
    const { workspace, editor, tab } = await openDraft(false)
    await workspace.ensureNoteFile(knowledgeBase.id, 'note-a', 'demo.js')
    workspace.updateNoteFileContent(fileKey, 'unsaved file')
    const fileTab = editor.openNoteFile(knowledgeBase, 'note-a', 'A', 'demo.js', 'text')
    confirm.mockResolvedValue({ ok: true, value: 'discard' })
    expect(await workspace.requestCloseTab(fileTab)).toBe(true)
    expect(confirm).toHaveBeenCalledWith(['A / demo.js'])
    expect(editor.activeTab).toMatchObject({ id: tab, dirty: true })
    expect(workspace.getNoteFileSession(knowledgeBase.id, 'note-a', 'demo.js')).toMatchObject({
      content: 'disk file',
      dirty: false
    })
    expect(workspace.getDocumentSession(knowledgeBase.id, 'note-a')?.content).toBe('unsaved draft')
    expect(saveFile).not.toHaveBeenCalled()
  })
})

describe('workspace app zoom', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useWorkspaceStore().applySettings({ ...autosaveSettings, appZoomPercent: 100 })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'desk')
  })

  it('keeps rapid steps visible and saves them in order despite slow responses', async () => {
    const first = deferred<DeskResult<AppSettings>>()
    const update = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (next: Partial<AppSettings>) => ({
        ok: true,
        value: { ...autosaveSettings, ...next }
      }))
    Object.defineProperty(window, 'desk', { configurable: true, value: { settings: { update } } })
    const workspace = useWorkspaceStore()
    const changes = [
      workspace.adjustAppZoom(1),
      workspace.adjustAppZoom(1),
      workspace.adjustAppZoom(1)
    ]
    expect(workspace.settings?.appZoomPercent).toBe(130)
    first.resolve({ ok: true, value: { ...autosaveSettings, appZoomPercent: 110 } })
    await changes[0]
    expect(workspace.settings?.appZoomPercent).toBe(130)
    await Promise.all(changes)
    expect(update.mock.calls.map(([patch]) => patch)).toEqual([
      { appZoomPercent: 110 },
      { appZoomPercent: 120 },
      { appZoomPercent: 130 }
    ])
    expect(workspace.settings?.appZoomPercent).toBe(130)
  })

  it('clamps steps and ignores nonfinite values', async () => {
    const update = vi.fn(async (next: Partial<AppSettings>) => ({
      ok: true,
      value: { ...autosaveSettings, ...next }
    }))
    Object.defineProperty(window, 'desk', { configurable: true, value: { settings: { update } } })
    const workspace = useWorkspaceStore()
    await workspace.setAppZoom(195)
    await workspace.adjustAppZoom(1)
    expect(workspace.settings?.appZoomPercent).toBe(200)
    await workspace.adjustAppZoom(1)
    await workspace.setAppZoom(55)
    await workspace.adjustAppZoom(-1)
    expect(workspace.settings?.appZoomPercent).toBe(50)
    await workspace.adjustAppZoom(-1)
    await workspace.setAppZoom(NaN)
    await workspace.setAppZoom(Infinity)
    expect(update).toHaveBeenCalledTimes(4)
  })

  it('rolls back a failed save and allows a later retry', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce({ ok: true, value: { ...autosaveSettings, appZoomPercent: 130 } })
    Object.defineProperty(window, 'desk', { configurable: true, value: { settings: { update } } })
    const workspace = useWorkspaceStore()
    workspace.applySettings({ ...autosaveSettings, appZoomPercent: 120 })
    await expect(workspace.adjustAppZoom(1)).rejects.toThrow('disk unavailable')
    expect(workspace.settings?.appZoomPercent).toBe(120)
    await workspace.adjustAppZoom(1)
    expect(workspace.settings?.appZoomPercent).toBe(130)
  })
})

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
