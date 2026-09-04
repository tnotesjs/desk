// Header layout and inline rename, using only an isolated temporary KB/profile.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const deskDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = mkdtempSync(join(tmpdir(), 'desk-note-header-'))
const workspace = join(fixture, 'workspace')
const profile = join(fixture, 'profile')
const kb = join(workspace, 'TNotes.note-header')
const note = join(kb, 'notes', '0001. 概述')
const shots = join(deskDir, 'scripts', 'shots', 'note-header')
mkdirSync(note, { recursive: true })
mkdirSync(profile, { recursive: true })
mkdirSync(shots, { recursive: true })
const kbConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/.tnotes.json'), 'utf8')
)
kbConfig.id = '10000000-0000-4000-8000-000000000031'
kbConfig.repoName = 'TNotes.note-header'
kbConfig.sidebarShowNoteId = false
kbConfig.root_item = { ...kbConfig.root_item, title: 'note-header' }
writeFileSync(join(kb, '.tnotes.json'), JSON.stringify(kbConfig))
writeFileSync(join(kb, 'TOC.md'), '- [ ] 0001. 概述\n')
writeFileSync(join(kb, 'sidebar.json'), '[]\n')
const noteConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/notes/0041. new/.tnotes.json'), 'utf8')
)
noteConfig.id = '10000000-0000-4000-8000-000000000032'
writeFileSync(join(note, '.tnotes.json'), JSON.stringify(noteConfig))
writeFileSync(
  join(note, 'README.md'),
  '# [0001. 概述](https://github.com/tnotesjs/desk)\n\n## 正文\n\nInitial content.\n'
)
writeFileSync(join(profile, 'workspace.v1.json'), JSON.stringify({ path: workspace }))
writeFileSync(
  join(profile, '.tn-desk-config.json'),
  JSON.stringify({
    version: 1,
    theme: 'light',
    defaultNoteView: 'visual',
    prettier: false,
    autosave: { enabled: false, delayMs: 1000 }
  })
)

const app = await _electron.launch({
  executablePath: require('electron'),
  args: ['out/main/index.js', `--user-data-dir=${profile}`],
  cwd: deskDir,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function waitUntil(predicate) {
  const deadline = Date.now() + 10000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for disk changes')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('note-header', { exact: true }).first().click()
  await page.getByText('概述', { exact: true }).first().click()
  const pm = page.locator('.milkdown .ProseMirror')
  await pm.waitFor()
  const title = page.getByRole('button', { name: '重命名笔记', exact: true })
  const input = page.getByRole('textbox', { name: '笔记名称', exact: true })
  for (const mode of ['可视化编辑', '只读视图', '源码视图']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    assert.equal(await page.locator('.format-actions').count(), mode === '可视化编辑' ? 1 : 0)
    assert.equal(await page.locator('.note-pane .save-button').count(), 0)
    const bounds = await page.locator('.document-toolbar').evaluate((bar) => {
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      const box = (selector) => {
        const rect = bar.querySelector(selector).getBoundingClientRect()
        return { x: rect.x, right: rect.right }
      }
      return {
        title: box('.document-path'),
        width: box('.page-width-toggle'),
        divider: box('.view-divider'),
        views: box('.view-switcher'),
        right: bar.getBoundingClientRect().right
      }
    })
    assert.ok(bounds.title.right <= bounds.width.x)
    assert.ok(bounds.width.right < bounds.divider.x)
    assert.ok(bounds.divider.right < bounds.views.x)
    assert.ok(bounds.right - bounds.views.right < 20)
    if (mode === '可视化编辑') {
      const toolbar = await page.locator('.document-toolbar').boundingBox()
      const format = await page.locator('.format-actions').boundingBox()
      assert.ok(format.y >= toolbar.y + toolbar.height)
    }
    await page.screenshot({ path: join(shots, `${mode}.png`) })
  }
  console.log(
    '✓ title left; width | views right; formatting is a separate visual-only row; no save button'
  )

  await title.click()
  assert.equal(await input.inputValue(), '概述')
  assert.equal(await page.locator('.document-path .note-index').innerText(), '0001.')
  assert.equal(await input.evaluate((element) => document.activeElement === element), true)
  await input.fill('取消的名称')
  await input.press('Escape')
  assert.equal(await title.innerText(), '概述')
  await title.click()
  await input.fill('   ')
  await page.getByRole('button', { name: '只读视图', exact: true }).click()
  assert.equal(await title.innerText(), '概述')

  // Make a real unsaved body edit, then rename on blur. Renaming must save it first.
  await page.getByRole('button', { name: '可视化编辑', exact: true }).click()
  await pm.getByText('Initial content.', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' KEEP-DRAFT')
  await page.waitForFunction(() => document.querySelector('.tab.is-dirty, .tab .dirty-dot'))
  await title.click()
  await input.fill('  新的名称  ')
  await page.screenshot({ path: join(shots, 'inline-title.png') })
  assert.equal(existsSync(note), true)
  await page.getByRole('button', { name: '只读视图', exact: true }).click()
  const renamedNote = join(kb, 'notes', '0001. 新的名称')
  await waitUntil(() => existsSync(join(renamedNote, 'README.md')))
  await page.waitForFunction(
    () => document.querySelector('.note-title-button')?.textContent.trim() === '新的名称'
  )
  assert.equal(existsSync(note), false)
  assert.match(readFileSync(join(renamedNote, 'README.md'), 'utf8'), /KEEP-DRAFT/)
  assert.match(readFileSync(join(renamedNote, 'README.md'), 'utf8'), /0001\. 新的名称/)
  assert.match(readFileSync(join(kb, 'TOC.md'), 'utf8'), /0001\. 新的名称/)
  assert.equal(
    JSON.parse(readFileSync(join(renamedNote, '.tnotes.json'), 'utf8')).id,
    noteConfig.id
  )
  assert.equal(await page.locator('.tab').filter({ hasText: '新的名称' }).count(), 1)
  assert.equal(
    (await page.locator('.toc-nodes .node-label').filter({ hasText: '新的名称' }).count()) > 0,
    true
  )
  assert.equal(await page.locator('.document-path .note-index').innerText(), '0001.')
  console.log(
    '✓ blur trims/renames directory, generated title, TOC and tab; index/UUID and unsaved text preserved'
  )

  // Rename works in readonly view too: the view mode does not lock metadata.
  await page.getByRole('button', { name: '只读视图', exact: true }).click()
  await title.click()
  await input.fill('最终名称')
  await input.press('Enter')
  const finalNote = join(kb, 'notes', '0001. 最终名称')
  await waitUntil(() => existsSync(join(finalNote, 'README.md')))
  await page.waitForFunction(
    () => document.querySelector('.note-title-button')?.textContent.trim() === '最终名称'
  )
  await page.getByRole('button', { name: '可视化编辑', exact: true }).click()
  await pm.getByText(/KEEP-DRAFT/).click()
  await page.keyboard.type(' SHORTCUT-SAVED')
  await page.waitForFunction(() => document.querySelector('.tab.is-dirty, .tab .dirty-dot'))
  await page.keyboard.press('ControlOrMeta+s')
  await waitUntil(() =>
    readFileSync(join(finalNote, 'README.md'), 'utf8').includes('SHORTCUT-SAVED')
  )
  await page.getByRole('button', { name: '标准页宽', exact: true }).click()
  await page.getByRole('button', { name: '超宽显示', exact: true }).waitFor()
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await page.screenshot({ path: join(shots, 'renamed-dark.png') })
  console.log('✓ readonly-view rename via Enter, width toggle and Cmd/Ctrl+S still work')
} catch (error) {
  const page = await app.firstWindow()
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await app.close()
  rmSync(fixture, { recursive: true, force: true })
}
