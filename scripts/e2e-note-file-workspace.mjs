// Runtime coverage for the note-directory multi-file workspace. The fixture is
// isolated in /tmp; this never writes to desk/playground or a user's notes.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const deskDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'desk-note-files-e2e-'))
const workspace = join(fixtureRoot, 'workspace')
const profile = join(fixtureRoot, 'profile')
const kb = join(workspace, 'TNotes.note-files-e2e')
const note = join(kb, 'notes', '0001. workspace-note')
const sourceFile = join(note, 'demos', '17', '1.js')
const shots = join(deskDir, 'scripts', 'shots', 'note-file-workspace')

mkdirSync(join(note, 'demos', '17'), { recursive: true })
mkdirSync(join(note, 'assets'), { recursive: true })
mkdirSync(profile, { recursive: true })
mkdirSync(shots, { recursive: true })

const kbConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground', 'TNotes.docs', '.tnotes.json'), 'utf8')
)
kbConfig.id = '10000000-0000-4000-8000-000000000001'
kbConfig.repoName = 'TNotes.note-files-e2e'
kbConfig.sidebarShowNoteId = false
kbConfig.root_item = { ...kbConfig.root_item, title: 'note-files-e2e', details: 'isolated e2e' }
writeFileSync(join(kb, '.tnotes.json'), `${JSON.stringify(kbConfig, null, 2)}\n`)
writeFileSync(join(kb, 'TOC.md'), '- [ ] 0001. workspace-note\n')
writeFileSync(join(kb, 'sidebar.json'), '[]\n')

const noteConfig = JSON.parse(
  readFileSync(
    join(deskDir, 'playground', 'TNotes.docs', 'notes', '0041. new', '.tnotes.json'),
    'utf8'
  )
)
noteConfig.id = '10000000-0000-4000-8000-000000000002'
writeFileSync(join(note, '.tnotes.json'), `${JSON.stringify(noteConfig, null, 2)}\n`)
writeFileSync(
  join(note, 'README.md'),
  '# Workspace note\n\nInline `highlight` text.\n\n::: code-group\n<<< ./demos/17/1.js [demo]\n:::\n'
)
writeFileSync(sourceFile, 'export const value = 1\n')
writeFileSync(
  join(note, 'assets', 'pixel.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#826cff"/></svg>\n'
)
writeFileSync(
  join(profile, 'workspace.v1.json'),
  `${JSON.stringify({ path: workspace }, null, 2)}\n`
)
writeFileSync(
  join(profile, 'settings.json'),
  `${JSON.stringify(
    {
      version: 1,
      theme: 'light',
      defaultNoteView: 'visual',
      autosave: { enabled: true, delayMs: 100 }
    },
    null,
    2
  )}\n`
)

const app = await _electron.launch({
  executablePath: electronPath,
  args: ['out/main/index.js', `--user-data-dir=${profile}`],
  cwd: deskDir,
  timeout: 60000,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})

/** @param {() => boolean} predicate @returns {Promise<void>} */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function waitUntil(predicate) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for file save')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

try {
  const page = await app.firstWindow({ timeout: 30000 })
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('note-files-e2e', { exact: true }).first().waitFor({ timeout: 30000 })
  await page.getByText('note-files-e2e', { exact: true }).first().click()
  await page.getByText('workspace-note', { exact: true }).first().click()

  const tocRow = page.locator('.toc-row[data-note-uuid]').first()
  await tocRow.click({ button: 'right' })
  const noteMenu = page.locator('.note-context-menu')
  await noteMenu.waitFor({ timeout: 5000 })
  assert.match(await noteMenu.innerText(), /复制路径/)
  assert.match(await noteMenu.innerText(), /在 Finder 中显示/)
  assert.match(await noteMenu.innerText(), /固定/)
  await noteMenu.getByRole('menuitem', { name: '固定', exact: true }).click()
  assert.equal(await page.locator('.pinned-row .tab', { hasText: 'workspace-note' }).count(), 1)
  await tocRow.click({ button: 'right' })
  await noteMenu.getByRole('menuitem', { name: '解除固定', exact: true }).click()

  const inlineCodeColor = await page
    .locator('.ProseMirror code')
    .first()
    .evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent-strong)'
      document.body.append(probe)
      const expected = getComputedStyle(probe).color
      probe.remove()
      return { actual: getComputedStyle(element).color, expected }
    })
  assert.equal(inlineCodeColor.actual, inlineCodeColor.expected)

  const tree = page.locator('.note-file-sidebar')
  await tree.waitFor({ timeout: 30000 })
  await tree.locator('.tree-row[title="demos"]').click()
  await tree.locator('.tree-row[title="demos/17"]').click()
  await tree.locator('.tree-row[title="demos/17/1.js"]').click()

  const filePane = page.locator('.note-file-pane')
  await filePane.waitFor({ timeout: 10000 })
  assert.equal(await page.locator('.tab', { hasText: 'workspace-note' }).count(), 1)
  assert.equal(await page.locator('.tab', { hasText: 'demos/17/1.js' }).count(), 1)
  assert.equal(
    await tree
      .locator('.tree-row[title="demos/17/1.js"]')
      .getAttribute('class')
      .then((v) => v?.includes('active')),
    true
  )

  const fileEditor = filePane.locator('.cm-content')
  await fileEditor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('export const value = 2\n')
  await waitUntil(() => readFileSync(sourceFile, 'utf8') === 'export const value = 2\n')

  await page.locator('.tab', { hasText: 'workspace-note' }).click()
  const includeEditor = page.locator('.desk-raw-block__include-cm .cm-content').first()
  await includeEditor.waitFor({ timeout: 10000 })
  assert.match(await includeEditor.innerText(), /value = 2/)

  await includeEditor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('export const value = 3\n')
  await page.locator('.tab', { hasText: 'demos/17/1.js' }).click()
  assert.match(await fileEditor.innerText(), /value = 3/)
  await page.keyboard.press('ControlOrMeta+S')
  await waitUntil(() => readFileSync(sourceFile, 'utf8') === 'export const value = 3\n')

  await tree.locator('.tree-row[title="assets"]').click({ timeout: 5000 })
  await tree.locator('.tree-row[title="assets/pixel.svg"]').click()
  await page.locator('.image-preview img').waitFor({ timeout: 10000 })
  await page.screenshot({ path: join(shots, 'note-file-workspace.png') })

  const imageTab = page.locator('.tab', { hasText: 'assets/pixel.svg' })
  await imageTab.click({ button: 'right' })
  await page.locator('.tab-context-menu').getByRole('menuitem', { name: /固定/ }).click()
  assert.equal(await page.locator('.pinned-row .tab', { hasText: 'assets/pixel.svg' }).count(), 1)
  await imageTab.dispatchEvent('auxclick', { button: 1 })
  assert.equal(await imageTab.count(), 0)

  console.log(
    '✓ note tree, TOC menu, VitePress inline code color, shared file state and middle-click close'
  )
} finally {
  await app.close()
  rmSync(fixtureRoot, { recursive: true, force: true })
}
