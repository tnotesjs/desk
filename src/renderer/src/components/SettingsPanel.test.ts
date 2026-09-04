// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppSettings } from '../../../shared/contracts'
import { MARKDOWN_BLOCK_SHORTCUTS, MARKDOWN_INLINE_SHORTCUTS } from '../markdown/markdownInputRules'
import { TN_NOTES_SLASH_ITEMS } from '../markdown/slashMenu'
import { useWorkspaceStore } from '../stores/workspace'
import SettingsPanel from './SettingsPanel.vue'

const settings: AppSettings = {
  version: 1,
  theme: 'system',
  density: 'comfortable',
  defaultNoteView: 'visual',
  defaultNotePageWidth: 'standard',
  noteTocDisplay: 'expanded',
  appZoomPercent: 100,
  autosave: { enabled: true, delayMs: 800 },
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

beforeEach(() => {
  setActivePinia(createPinia())
  useWorkspaceStore().applySettings(settings)
  Object.defineProperty(window, 'desk', {
    configurable: true,
    value: {
      settings: {
        imageTokenStatus: vi.fn(async () => ({
          ok: true,
          value: { configured: false, encryptionAvailable: true }
        }))
      }
    }
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'desk')
})

describe('SettingsPanel Markdown quick-input catalog', () => {
  it('defaults the note page width control to standard', () => {
    const wrapper = mount(SettingsPanel)
    const field = wrapper
      .findAll('label.field')
      .find((candidate) => candidate.text().includes('笔记默认页宽'))

    expect(field?.find('select').element.value).toBe('standard')
  })

  it('defaults the in-note table of contents control to expanded', () => {
    const wrapper = mount(SettingsPanel)
    const field = wrapper
      .findAll('label.field')
      .find((candidate) => candidate.text().includes('笔记内目录'))

    expect(field?.find('select').element.value).toBe('expanded')
  })

  it('renders every shared slash, block, and inline shortcut entry', async () => {
    const wrapper = mount(SettingsPanel)
    await wrapper.get('button.nav-item:nth-child(7)').trigger('click')

    const group = wrapper
      .findAll('.shortcut-group')
      .find((candidate) => candidate.find('h3').text().includes('Markdown 快速输入'))
    expect(group?.exists()).toBe(true)
    const text = group?.text() ?? ''

    for (const item of TN_NOTES_SLASH_ITEMS) {
      expect(text).toContain(item.label)
      expect(text).toContain(item.shortcut)
      expect(text).toContain(item.keywords.join(', '))
    }
    for (const item of MARKDOWN_BLOCK_SHORTCUTS) {
      expect(text).toContain(item.syntax)
      for (const alias of item.aliases) expect(text).toContain(alias)
      expect(text).toContain(item.trigger)
    }
    for (const item of MARKDOWN_INLINE_SHORTCUTS) {
      expect(text).toContain(item.label)
      expect(text).toContain(item.syntax)
      expect(text).toContain(item.trigger)
    }
  })
})

describe('SettingsPanel live app zoom', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    let saved = structuredClone(settings)
    window.desk.settings.update = vi.fn(async (next) => {
      saved = { ...saved, ...next }
      return { ok: true, value: saved } as const
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('shows current zoom and never overwrites shortcuts with a stale settings draft', async () => {
    const store = useWorkspaceStore()
    await store.setAppZoom(120)
    const wrapper = mount(SettingsPanel)
    const input = wrapper.get<HTMLInputElement>('[aria-label="应用缩放百分比"]')
    expect(input.element.value).toBe('120')
    // The ordinary settings draft is still debounced when zoom is changed by a shortcut.
    await wrapper.get('select').setValue('dark')
    await store.adjustAppZoom(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(store.settings).toMatchObject({ theme: 'dark', appZoomPercent: 130 })
    expect(input.element.value).toBe('130')
    await wrapper.get('[aria-label="放大应用"]').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(store.settings?.appZoomPercent).toBe(140)
    await wrapper.get('.reset-group').trigger('click')
    await vi.advanceTimersByTimeAsync(500)
    expect(store.settings?.appZoomPercent).toBe(100)
    expect(input.element.value).toBe('100')
    wrapper.unmount()
  })
})
