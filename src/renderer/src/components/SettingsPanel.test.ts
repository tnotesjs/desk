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
