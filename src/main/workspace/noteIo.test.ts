import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorkspace } from '@tnotesjs/core/workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { listNoteFiles, readNoteTextFile, saveNoteTextFile } from './noteIo'
import { descriptor } from './dto'

import type { KnowledgeBaseHandle } from './types'

const temporaryDirectories: string[] = []

async function createHandle(): Promise<KnowledgeBaseHandle> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'desk-note-files-'))
  temporaryDirectories.push(rootPath)
  const notePath = path.join(rootPath, 'notes', '0001. Alpha')
  await fs.mkdir(path.join(notePath, 'demos'), { recursive: true })
  await fs.mkdir(path.join(notePath, 'node_modules'))
  await fs.writeFile(
    path.join(rootPath, '.tnotes.json'),
    JSON.stringify({
      id: 'kb-fixture',
      author: 'tnotesjs',
      repoName: 'TNotes.fixture',
      keywords: [],
      sidebarShowNoteId: false,
      ignore_dirs: [],
      socialLinks: [],
      menuItems: [],
      root_item: {
        title: 'Fixture',
        completed_notes_count: {},
        details: '',
        link: 'https://tnotesjs.github.io/TNotes.fixture/'
      }
    })
  )
  await fs.writeFile(path.join(rootPath, 'README.md'), '# Fixture\n')
  await fs.writeFile(path.join(rootPath, 'TOC.md'), '- [ ] 0001. Alpha\n')
  await fs.writeFile(path.join(rootPath, 'sidebar.json'), '[]\n')
  await fs.writeFile(
    path.join(notePath, '.tnotes.json'),
    JSON.stringify({
      id: 'note-alpha',
      bilibili: [],
      tnotes: [],
      yuque: [],
      done: false,
      enableDiscussions: false,
      description: ''
    })
  )
  await fs.writeFile(path.join(notePath, 'README.md'), '# Alpha\n')
  await fs.writeFile(path.join(notePath, '.env'), 'SECRET=1\n')
  const sourcePath = path.join(notePath, 'demos', 'index.js')
  await fs.writeFile(sourcePath, 'export const value = 1\n')
  await fs.chmod(sourcePath, 0o755)

  const workspace = createWorkspace({ rootPath })
  // Force the adapter path even after Desk upgrades to a Core version with noteFiles.
  ;(workspace as unknown as { noteFiles?: unknown }).noteFiles = undefined
  const snapshot = await workspace.inspect()
  return {
    id: snapshot.id,
    name: 'TNotes.fixture',
    rootPath,
    workspace,
    snapshot
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('note-file Core compatibility adapter', () => {
  it('exposes configured GitHub repository and Page links', async () => {
    const handle = await createHandle()

    expect(descriptor(handle)).toMatchObject({
      repositoryUrl: 'https://github.com/tnotesjs/TNotes.fixture',
      pageUrl: 'https://tnotesjs.github.io/TNotes.fixture/'
    })

    await handle.workspace.dispose()
  })

  it('lists lazily, saves by revision, and protects canonical metadata paths', async () => {
    const handle = await createHandle()
    const effects = { markInternalWrites: vi.fn(), emitChanged: vi.fn() }

    await expect(
      listNoteFiles(handle, { knowledgeBaseId: handle.id, noteUuid: 'note-alpha' })
    ).resolves.toEqual([
      { name: 'demos', path: 'demos', kind: 'directory', fileKind: null, size: null },
      expect.objectContaining({ name: 'README.md', fileKind: 'text' })
    ])
    const before = await readNoteTextFile(handle, {
      knowledgeBaseId: handle.id,
      noteUuid: 'note-alpha',
      path: 'demos/index.js'
    })
    const saved = await saveNoteTextFile(
      handle,
      {
        knowledgeBaseId: handle.id,
        noteUuid: 'note-alpha',
        path: 'demos/index.js',
        content: 'export const value = 2\n',
        expectedRevision: before.revision
      },
      effects
    )

    expect(saved.content).toBe('export const value = 2\n')
    expect(saved.revision).not.toBe(before.revision)
    expect(
      (await fs.stat(path.join(handle.rootPath, 'notes', '0001. Alpha', 'demos', 'index.js')))
        .mode & 0o111
    ).toBe(0o111)
    expect(effects.markInternalWrites).toHaveBeenCalledOnce()
    expect(effects.emitChanged).toHaveBeenCalledOnce()

    await expect(
      saveNoteTextFile(
        handle,
        {
          knowledgeBaseId: handle.id,
          noteUuid: 'note-alpha',
          path: 'demos/../README.md',
          content: '# bypass\n',
          expectedRevision: before.revision
        },
        effects
      )
    ).rejects.toThrow('笔记文件路径无效')
    const readme = await readNoteTextFile(handle, {
      knowledgeBaseId: handle.id,
      noteUuid: 'note-alpha',
      path: 'README.md'
    })
    await expect(
      saveNoteTextFile(
        handle,
        {
          knowledgeBaseId: handle.id,
          noteUuid: 'note-alpha',
          path: 'demos%2F..%2FREADME.md',
          content: '# bypass\n',
          expectedRevision: readme.revision
        },
        effects
      )
    ).rejects.toThrow('README.md 必须通过笔记保存接口修改')

    await handle.workspace.dispose()
  })
})
