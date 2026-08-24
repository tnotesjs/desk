// @vitest-environment happy-dom

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useEditorStore } from './editor'

import type { AppSettings, KnowledgeBaseDescriptor } from '../../../shared/contracts'

const settings: AppSettings = {
  version: 1,
  theme: 'system',
  density: 'comfortable',
  defaultNoteView: 'visual',
  autosave: { enabled: true, delayMs: 800 },
  prettier: true,
  ide: 'vscode',
  gitPath: null,
  nodePath: null,
  confirmBeforeCommit: false,
  tabs: { maxOpenCount: 10, wrap: true, autoRevealInToc: true },
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
  hiddenKnowledgeBases: [],
  knowledgeBases: {}
}

const knowledgeBase: KnowledgeBaseDescriptor = {
  id: 'kb-a',
  configId: 'TNotes.docs',
  name: 'TNotes.docs',
  rootPath: '/tmp/TNotes.docs',
  displayName: 'docs',
  icon: null,
  health: 'ready',
  diagnostics: [],
  noteCount: 3,
  snapshotRevision: 'revision'
}

describe('editor store tab semantics', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(100)
  })

  afterEach(() => vi.useRealTimers())

  it('reuses one preview tab per group and keeps a double-opened tab', () => {
    const editor = useEditorStore()
    editor.configure(settings)

    editor.openNote(knowledgeBase, 'note-a', 'A', 'visual')
    editor.openNote(knowledgeBase, 'note-b', 'B', 'visual')

    expect(editor.activeGroup?.tabs).toHaveLength(1)
    expect(editor.activeTab).toMatchObject({ noteUuid: 'note-b', preview: true })

    editor.keepOpen(editor.activeTab!.id)
    editor.openNote(knowledgeBase, 'note-c', 'C', 'visual')

    expect(editor.activeGroup?.tabs).toHaveLength(2)
    expect(editor.activeGroup?.tabs[0]).toMatchObject({ noteUuid: 'note-b', preview: false })
    expect(editor.activeTab).toMatchObject({ noteUuid: 'note-c', preview: true })
  })

  it('protects pinned tabs from explicit close', () => {
    const editor = useEditorStore()
    const tabId = editor.openNote(knowledgeBase, 'note-a', 'A', 'visual', undefined, 'permanent')
    const groupId = editor.activeGroup!.id

    editor.setPinned(tabId, true)

    expect(editor.close(groupId, tabId)).toBe(false)
    expect(editor.activeGroup?.tabs).toHaveLength(1)
  })

  it('evicts the oldest closable tab when the configured limit is reached', () => {
    const editor = useEditorStore()
    editor.configure({ ...settings, tabs: { ...settings.tabs, maxOpenCount: 2 } })

    editor.openNote(knowledgeBase, 'note-a', 'A', 'visual', undefined, 'permanent')
    vi.setSystemTime(200)
    editor.openNote(knowledgeBase, 'note-b', 'B', 'visual', undefined, 'permanent')
    vi.setSystemTime(300)
    editor.openNote(knowledgeBase, 'note-c', 'C', 'visual', undefined, 'permanent')

    expect(editor.activeGroup?.tabs.map((tab) => tab.type === 'note' && tab.noteUuid)).toEqual([
      'note-b',
      'note-c'
    ])
  })
})
