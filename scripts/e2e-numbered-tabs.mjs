// Cmd/Ctrl+digits must use the focused split group, including native web views.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const deskDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = mkdtempSync(join(tmpdir(), 'desk-numbered-tabs-'))
const workspace = join(fixture, 'workspace')
const profile = join(fixture, 'profile')
const kb = join(workspace, 'TNotes.numbered-tabs')
const shots = join(deskDir, 'scripts', 'shots', 'numbered-tabs')
mkdirSync(kb, { recursive: true })
mkdirSync(profile, { recursive: true })
mkdirSync(shots, { recursive: true })
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end('<title>Local tab page</title><p>Native web view</p><input autofocus>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const webUrl = `http://127.0.0.1:${server.address().port}/`
const kbConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/.tnotes.json'), 'utf8')
)
kbConfig.id = '10000000-0000-4000-8000-000000000061'
kbConfig.repoName = 'TNotes.numbered-tabs'
kbConfig.root_item = { ...kbConfig.root_item, title: 'numbered-tabs' }
writeFileSync(join(kb, '.tnotes.json'), JSON.stringify(kbConfig))
const noteConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/notes/0041. new/.tnotes.json'), 'utf8')
)
const names = ['tab-A', 'tab-B', 'tab-C', 'tab-D', 'tab-E', 'tab-F']
const toc = names.map((name, index) => {
  const dir = `${String(index + 1).padStart(4, '0')}. ${name}`
  const note = join(kb, 'notes', dir)
  mkdirSync(note, { recursive: true })
  writeFileSync(
    join(note, '.tnotes.json'),
    JSON.stringify({
      ...noteConfig,
      id: `10000000-0000-4000-8000-00000000007${index}`
    })
  )
  writeFileSync(
    join(note, 'README.md'),
    `# ${name}\n\nBody ${name}.\n\n[Local website](${webUrl})\n`
  )
  writeFileSync(join(note, 'demo.js'), 'const example = 1\n')
  return `- [ ] ${dir}`
})
writeFileSync(join(kb, 'TOC.md'), `${toc.join('\n')}\n`)
writeFileSync(join(kb, 'sidebar.json'), '[]\n')
writeFileSync(join(profile, 'workspace.v1.json'), JSON.stringify({ path: workspace }))
writeFileSync(
  join(profile, '.tn-desk-config.json'),
  JSON.stringify({
    version: 1,
    theme: 'light',
    defaultNoteView: 'visual',
    prettier: false,
    autosave: { enabled: false, delayMs: 1000 },
    tabs: { maxOpenCount: 20, wrap: true, autoRevealInToc: true }
  })
)

const app = await _electron.launch({
  executablePath: require('electron'),
  args: ['out/main/index.js', `--user-data-dir=${profile}`],
  cwd: deskDir,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('numbered-tabs', { exact: true }).first().click()
  for (const name of names.slice(0, 3))
    await page.getByText(name, { exact: true }).first().dblclick()
  await page.getByRole('button', { name: '向右拆分当前标签', exact: true }).click()
  for (const name of names.slice(3)) await page.getByText(name, { exact: true }).first().dblclick()
  const groups = page.locator('.editor-group')
  const left = groups.nth(0)
  const right = groups.nth(1)
  // Electron's before-input-event shortcuts need native input, not CDP-only
  // renderer Keyboard.dispatchKeyEvent used by page.keyboard.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const shortcut = async (key, shift = false) => {
    await app.evaluate(
      ({ BrowserWindow }, { key, shift }) => {
        const window = BrowserWindow.getAllWindows()[0]
        const contents = window.webContents
        contents.focus()
        const modifiers = [process.platform === 'darwin' ? 'meta' : 'control']
        if (shift) modifiers.push('shift')
        contents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
        contents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
      },
      { key, shift }
    )
  }
  assert.equal(await left.locator('.tab').count(), 3)
  assert.equal(await right.locator('.tab').count(), 4)
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const check = async (leftTitle, rightTitle, active) => {
    await page.waitForFunction(
      ({ leftTitle, rightTitle, active }) => {
        const groups = [...document.querySelectorAll('.editor-group')]
        return (
          groups[0]?.querySelector('.tab.selected .tab-title')?.textContent === leftTitle &&
          groups[1]?.querySelector('.tab.selected .tab-title')?.textContent === rightTitle &&
          groups[active]?.classList.contains('active')
        )
      },
      { leftTitle, rightTitle, active },
      { timeout: 5000 }
    )
  }
  await left.locator('.tab').filter({ hasText: 'tab-B' }).click()
  await shortcut('1')
  await check('tab-A', 'tab-F', 0)
  await shortcut('3')
  await check('tab-C', 'tab-F', 0)
  for (const digit of ['4', '9']) {
    await shortcut(digit)
    await check('tab-C', 'tab-F', 0)
  }
  await right.locator('.tab').filter({ hasText: 'tab-D' }).click()
  await shortcut('1')
  await check('tab-C', 'tab-C', 1)
  await shortcut('4')
  await check('tab-C', 'tab-F', 1)
  console.log('✓ left 3 / right 4 tabs use independent one-based indices; out-of-range is inert')

  await right.locator('.ProseMirror:visible').getByText('Body tab-F.', { exact: true }).click()
  await shortcut('2')
  await check('tab-C', 'tab-D', 1)
  await right.getByRole('button', { name: '源码视图', exact: true }).click()
  await right.locator('.cm-source-editor .cm-content:visible').click()
  await shortcut('3')
  await check('tab-C', 'tab-E', 1)
  const expand = page.getByRole('button', { name: '展开笔记文件', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.locator('.note-file-sidebar .tree-row[title="demo.js"]').click()
  await right.locator('.note-file-pane .cm-content:visible').click()
  await shortcut('4')
  await check('tab-C', 'tab-F', 1)
  console.log('✓ shortcuts work from visual/source editors and ordinary code-file tabs')

  await left.locator('.tab').filter({ hasText: 'tab-C' }).click()
  await shortcut('k')
  await shortcut('Enter', true)
  await left.locator('.tab.pinned').waitFor()
  await shortcut('2')
  await check('tab-A', 'tab-F', 0)
  await shortcut('1')
  await check('tab-C', 'tab-F', 0)
  assert.equal(await left.locator('.tab.pinned .tab-title').innerText(), 'tab-C')
  console.log('✓ pinned tabs are numbered first, matching their displayed row')

  await right
    .locator('.ProseMirror:visible')
    .getByRole('link', { name: 'Local website' })
    .click({ modifiers: ['ControlOrMeta'] })
  await right.locator('.web-pane:visible').waitFor()
  await right.locator('.tab.selected .tab-title').filter({ hasText: 'Local tab page' }).waitFor()
  // Leave the renderer's last focused group on the left, then focus the native
  // right-hand web view (which cannot bubble focusin through the renderer DOM).
  await left.locator('.tab').filter({ hasText: 'tab-A' }).click()
  await app.evaluate(({ webContents }, url) => {
    const web = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!web) throw new Error('Missing local web view')
    web.focus()
    const modifiers = [process.platform === 'darwin' ? 'meta' : 'control']
    web.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers })
    web.sendInputEvent({ type: 'keyUp', keyCode: '1', modifiers })
  }, webUrl)
  await check('tab-A', 'tab-C', 1)
  await shortcut('4')
  await check('tab-A', 'tab-F', 1)
  await shortcut('6')
  await check('tab-A', 'Local tab page', 1)
  await shortcut('9')
  await check('tab-A', 'Local tab page', 1)
  assert.equal(await right.locator('.web-pane:visible').count(), 1)
  await shortcut('5')
  await check('tab-A', 'demo.js', 1)
  console.log(
    '✓ native web-view origin wins over stale renderer focus; subsequent shortcuts stay in that group'
  )
  await page.screenshot({ path: join(shots, 'numbered-tabs.png') })
} catch (error) {
  const page = await app.firstWindow()
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await app.close()
  await new Promise((resolve) => server.close(resolve))
  rmSync(fixture, { recursive: true, force: true })
}
