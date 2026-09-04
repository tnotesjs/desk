// Runtime coverage for the note-directory multi-file workspace. The fixture is
// isolated in /tmp; this never writes to desk/playground or a user's notes.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const webServer = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end('<!doctype html><title>Zoom web fixture</title><h1>Zoom web fixture</h1>')
})
await new Promise((resolve) => webServer.listen(0, '127.0.0.1', resolve))
const webFixtureUrl = `http://127.0.0.1:${webServer.address().port}/`

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
writeFileSync(join(kb, 'TOC.md'), '- Workspace group\n  - [ ] 0001. workspace-note\n')
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
  '# [Workspace note](https://github.com/tnotesjs/TNotes.note-files-e2e/tree/main/notes/0001.%20workspace-note)\n\n<!-- region:toc -->\n- [Fixture section](#fixture-section)\n<!-- endregion:toc -->\n\nInline `highlight` text.\n\n## Fixture section\n\n::: code-group\n<<< ./demos/17/1.js [demo]\n:::\n\n' +
    `[Zoom web fixture](${webFixtureUrl})\n`
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
  join(profile, '.tn-desk-config.json'),
  `${JSON.stringify(
    {
      version: 1,
      theme: 'light',
      defaultNoteView: 'visual',
      prettier: false,
      autosave: { enabled: true, delayMs: 250 }
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

  const titleLink = page.locator('.desk-generated-title a')
  await titleLink.waitFor()
  const initialMarkdown = readFileSync(join(note, 'README.md'), 'utf8')
  for (const mode of ['可视化编辑', '只读视图']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme
      }, theme)
      const colors = await titleLink.evaluate((anchor) => {
        const bodyLink = document.querySelector('.ProseMirror p a')
        const reference = document.createElement('span')
        reference.style.color = 'var(--accent-strong)'
        document.body.append(reference)
        const result = {
          title: getComputedStyle(anchor).color,
          body: getComputedStyle(bodyLink).color,
          expected: getComputedStyle(reference).color
        }
        reference.remove()
        return result
      })
      assert.equal(colors.title, colors.body)
      assert.equal(colors.title, colors.expected)
      assert.equal(await titleLink.getAttribute('data-tooltip'), '在 Github 中打开')
      await titleLink.hover()
      await page.waitForFunction(() => {
        const tooltip = getComputedStyle(
          document.querySelector('.desk-generated-title a'),
          '::after'
        )
        return tooltip.visibility === 'visible' && tooltip.opacity === '1'
      })
      assert.equal(
        await titleLink.evaluate((anchor) => getComputedStyle(anchor, '::after').content),
        '"在 Github 中打开"'
      )
      await page.screenshot({ path: join(shots, `title-link-${mode}-${theme}.png`) })
      await page.locator('.titlebar').hover()
      await page.waitForFunction(() => {
        return (
          getComputedStyle(document.querySelector('.desk-generated-title a'), '::after')
            .visibility === 'hidden'
        )
      })
    }
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await page.getByRole('button', { name: '可视化编辑', exact: true }).click()
  assert.equal(readFileSync(join(note, 'README.md'), 'utf8'), initialMarkdown)
  console.log('✓ generated titles reuse link colors and GitHub tooltips in both themes and views')

  const blockHandle = page.locator('.milkdown-block-handle')
  // Milkdown hides the controls with opacity/pointer-events, not display/visibility.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const waitForBlockControls = async (shown) => {
    await page.waitForFunction((shown) => {
      const handle = document.querySelector('.milkdown-block-handle')
      if (!handle) return false
      const style = getComputedStyle(handle)
      return (
        handle.getAttribute('data-show') === String(shown) &&
        style.opacity === (shown ? '1' : '0') &&
        (shown ? style.pointerEvents !== 'none' : style.pointerEvents === 'none')
      )
    }, shown)
  }
  const bodyParagraph = page.locator('.ProseMirror > p').filter({ hasText: 'Inline' }).first()
  const generatedToc = page.locator('.desk-generated-toc')
  for (const target of [
    page.locator('.desk-generated-title'),
    titleLink,
    generatedToc,
    generatedToc.locator('a'),
    generatedToc.locator('button')
  ]) {
    await bodyParagraph.hover()
    await waitForBlockControls(true)
    assert.equal(await blockHandle.locator('.operation-item:visible').count(), 1)
    assert.equal(await blockHandle.locator('.operation-item:first-child').isVisible(), false)
    assert.equal(await blockHandle.locator('.operation-item:last-child').isVisible(), true)
    assert.equal(await blockHandle.evaluate((element) => element.getBoundingClientRect().width), 32)
    await target.hover()
    await waitForBlockControls(false)
  }
  await generatedToc.locator('button').click()
  assert.equal(await generatedToc.locator('button').getAttribute('aria-expanded'), 'false')
  await bodyParagraph.hover()
  await waitForBlockControls(true)
  await generatedToc.hover()
  await waitForBlockControls(false)
  await page.screenshot({ path: join(shots, 'generated-toc-no-block-handle.png') })
  await generatedToc.locator('button').click()
  await page.locator('.ProseMirror h2').hover()
  await waitForBlockControls(true)
  assert.equal(readFileSync(join(note, 'README.md'), 'utf8'), initialMarkdown)
  console.log('✓ no block controls on title/expanded/collapsed TOC; body controls still available')

  // Inspect actual Electron Menu instances without depending on OS popup automation.
  await app.evaluate(({ Menu, BrowserWindow }) => {
    globalThis.deskMenuTest = { action: null, items: null }
    Menu.prototype.popup = function (options) {
      globalThis.deskMenuTest.items = this.items.map(
        ({ id, label, type, enabled, accelerator }) => ({ id, label, type, enabled, accelerator })
      )
      const id = globalThis.deskMenuTest.action
      if (id) {
        const item = this.getMenuItemById(id)
        if (!item || !item.enabled) throw new Error('Native menu action unavailable: ' + id)
        item.click(item, BrowserWindow.getAllWindows()[0], {})
      }
      options.callback?.()
    }
  })
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const chooseMenu = async (target, action = null) => {
    await app.evaluate((_electron, action) => {
      globalThis.deskMenuTest = { action, items: null }
    }, action)
    await target.click({ button: 'right' })
    const items = await app.evaluate(async () => {
      const deadline = Date.now() + 5000
      while (!globalThis.deskMenuTest.items) {
        if (Date.now() > deadline) throw new Error('Native context menu did not open')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return globalThis.deskMenuTest.items
    })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    )
    assert.equal(await page.locator('.note-context-layer, .tab-context-layer').count(), 0)
    return items
  }
  const kbMenu = await chooseMenu(page.locator('.knowledge-item').first())
  assert.ok(kbMenu.some((item) => item.label === '打开 GitHub 仓库'))
  assert.ok(kbMenu.some((item) => item.label === '打开 GitHub Page'))
  const tocRow = page.locator('.toc-row[data-note-uuid]').first()
  const noteMenu = await chooseMenu(tocRow, 'toggle-pin')
  assert.ok(noteMenu.some((item) => item.label === '复制路径'))
  assert.ok(noteMenu.some((item) => item.label === '在 Finder 中显示'))
  assert.ok(noteMenu.some((item) => item.label === '固定'))
  assert.equal(await page.locator('.pinned-row .tab', { hasText: 'workspace-note' }).count(), 1)
  const pinnedMenu = await chooseMenu(tocRow, 'toggle-pin')
  assert.ok(pinnedMenu.some((item) => item.label === '解除固定'))
  console.log('✓ consistent native knowledge-base and note menus, pin/unpin and dismissal')

  const groupRow = page
    .locator('.toc-row')
    .filter({ has: page.locator('.node-label.group') })
    .first()
  const groupMenu = await chooseMenu(groupRow)
  assert.deepEqual(
    groupMenu.filter((item) => item.type !== 'separator').map((item) => item.id),
    ['rename', 'add-before', 'add-after', 'request-delete']
  )
  assert.equal(
    await page.locator('[aria-label="更多操作"], .row-menu, .row-menu-popover').count(),
    0
  )
  await tocRow.hover()
  assert.equal(await tocRow.getByRole('button', { name: '添加子笔记', exact: true }).count(), 1)
  const noteActionIds = noteMenu.filter((item) => item.type !== 'separator').map((item) => item.id)
  assert.deepEqual(noteActionIds, [
    'copy-path',
    'reveal-file',
    'toggle-pin',
    'open-split',
    'rename',
    'toggle-done',
    'open-ide',
    'add-before',
    'add-after',
    'request-delete'
  ])
  for (const [row, label] of [
    [groupRow, '重命名分组'],
    [tocRow, '重命名笔记']
  ]) {
    await chooseMenu(row, 'rename')
    const dialog = page.locator('.dialog').filter({ hasText: label })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    for (const action of ['add-before', 'add-after']) {
      await chooseMenu(row, action)
      const create = page.locator('.dialog').filter({ hasText: '新增笔记' })
      await create.waitFor()
      await create.locator('header button').click()
    }
    await chooseMenu(row, 'request-delete')
    const deletion = page.locator('.danger-dialog')
    await deletion.waitFor()
    assert.equal(existsSync(join(note, 'README.md')), true)
    await deletion.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(existsSync(join(note, 'README.md')), true)
  }
  console.log(
    '✓ group/note more actions merged into native menus; rename/create/delete confirmations retained'
  )

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
  const includeEditor = page.locator('.desk-raw-block__include-cm .cm-content:visible').first()
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
  const fileMenu = await chooseMenu(imageTab, 'toggle-pin')
  assert.deepEqual(
    fileMenu.filter((item) => item.type !== 'separator').map((item) => item.id),
    ['close', 'close-saved', 'close-all', 'close-web', 'toggle-pin']
  )
  assert.equal(await page.locator('.pinned-row .tab', { hasText: 'assets/pixel.svg' }).count(), 1)
  await imageTab.dispatchEvent('auxclick', { button: 1 })
  assert.equal(await imageTab.count(), 0)

  // Exercise tab-close decisions through real renderer -> preload -> main IPC.
  // Capture native dialog options and supply each user choice deterministically.
  await app.evaluate(({ dialog }) => {
    globalThis.deskCloseTest = { response: 2, options: null }
    dialog.showMessageBox = async (_window, options) => {
      globalThis.deskCloseTest.options = options
      return { response: globalThis.deskCloseTest.response, checkboxChecked: false }
    }
  })
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const answerClose = async (response, action) => {
    await app.evaluate((_electron, response) => {
      globalThis.deskCloseTest = { response, options: null }
    }, response)
    await action()
    const options = await app.evaluate(async () => {
      const deadline = Date.now() + 5000
      while (!globalThis.deskCloseTest.options) {
        if (Date.now() > deadline) throw new Error('Missing unsaved tab confirmation')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return globalThis.deskCloseTest.options
    })
    assert.deepEqual(options.buttons, ['保存', '不保存', '取消'])
    assert.equal(options.type, 'warning')
    assert.equal(options.cancelId, 2)
    await page.locator('.tab-close-blocker').waitFor({ state: 'hidden' })
    return options
  }
  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  await page.getByRole('checkbox', { name: '自动保存', exact: true }).uncheck()
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await waitUntil(
    () =>
      existsSync(join(profile, '.tn-desk-config.json')) &&
      !JSON.parse(readFileSync(join(profile, '.tn-desk-config.json'), 'utf8')).autosave.enabled
  )

  const noteTab = page.locator('.tab', { hasText: 'workspace-note' })
  await noteTab.click()
  await page.getByRole('button', { name: '源码视图', exact: true }).click()
  const sourceEditor = page.locator('.markdown-source-editor .cm-content')
  await sourceEditor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\nUnsaved close test\n')
  await noteTab.locator('.dirty-dot').waitFor()
  assert.match(
    (await sourceEditor.locator('.cm-line').allTextContents()).join('\n'),
    /::: code-group\n<<< /
  )
  const canceledNote = await answerClose(2, () =>
    app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      const modifiers = [process.platform === 'darwin' ? 'meta' : 'control']
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers })
    })
  )
  assert.match(canceledNote.message, /workspace-note/)
  assert.equal(await noteTab.count(), 1)
  assert.ok(!readFileSync(join(note, 'README.md'), 'utf8').includes('Unsaved close test'))
  await answerClose(0, () => noteTab.locator('.tab-close').click())
  assert.equal(await noteTab.count(), 0)
  assert.match(readFileSync(join(note, 'README.md'), 'utf8'), /Unsaved close test/)

  await tocRow.click()
  await page.locator('.tab', { hasText: 'demos/17/1.js' }).click()
  await fileEditor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('export const value = 4\n')
  const sourceTab = page.locator('.tab', { hasText: 'demos/17/1.js' })
  await chooseMenu(sourceTab, 'toggle-pin')
  await answerClose(2, () => sourceTab.dispatchEvent('auxclick', { button: 1 }))
  assert.equal(await page.locator('.pinned-row .tab', { hasText: 'demos/17/1.js' }).count(), 1)
  assert.equal(readFileSync(sourceFile, 'utf8'), 'export const value = 3\n')
  await answerClose(1, () => sourceTab.dispatchEvent('auxclick', { button: 1 }))
  assert.equal(await sourceTab.count(), 0)
  assert.equal(readFileSync(sourceFile, 'utf8'), 'export const value = 3\n')
  await tree.locator('.tree-row[title="demos/17/1.js"]').click()
  assert.match(await fileEditor.innerText(), /value = 3/)

  // Closing a README also protects edits made inside its included code files.
  await noteTab.click()
  await page.getByRole('button', { name: '可视化编辑', exact: true }).click()
  await includeEditor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('export const value = 5\n')
  const canceledInclude = await answerClose(2, () => noteTab.locator('.tab-close').click())
  assert.match(canceledInclude.message, /demos\/17\/1.js/)
  assert.equal(readFileSync(sourceFile, 'utf8'), 'export const value = 3\n')
  await page.getByRole('button', { name: '源码视图', exact: true }).click()
  await sourceEditor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\nDiscard this batch\n')
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const closeAll = async () => {
    await chooseMenu(noteTab, 'close-all')
  }
  const canceledBatch = await answerClose(2, closeAll)
  assert.match(canceledBatch.message, /2 个文件/)
  assert.equal(await page.locator('.tab').count(), 2)
  await answerClose(1, closeAll)
  assert.equal(await page.locator('.tab').count(), 0)
  assert.equal(readFileSync(sourceFile, 'utf8'), 'export const value = 3\n')
  assert.ok(!readFileSync(join(note, 'README.md'), 'utf8').includes('Discard this batch'))
  await page.reload()
  await tocRow.waitFor()
  assert.equal(await page.getByText('发现未保存的编辑', { exact: true }).count(), 0)
  await tocRow.click()
  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  await page.getByRole('checkbox', { name: '自动保存', exact: true }).check()
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  console.log(
    '✓ unsaved tabs: native confirmation, save/discard/cancel, middle-click, Cmd+W, batch close and recovery cleanup'
  )

  await page.locator('.tab', { hasText: 'workspace-note' }).click()
  const baselineWidth = await page.evaluate(() => window.innerWidth)
  const settingsPanel = page.locator('.settings-panel')
  const capsule = page.getByRole('group', { name: '应用缩放', exact: true })
  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  const zoomInput = settingsPanel.getByRole('textbox', { name: '应用缩放百分比' })
  assert.equal(await zoomInput.inputValue(), '100')

  // Exercise native keyboard interception rather than synthetic DOM key handlers.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const zoomKey = async (key, shift = false, web = false) => {
    await app.evaluate(
      ({ BrowserWindow }, { key, shift, web }) => {
        const window = BrowserWindow.getAllWindows()[0]
        const contents = web ? window.contentView.children[0].webContents : window.webContents
        const modifiers = [
          process.platform === 'darwin' ? 'meta' : 'control',
          ...(shift ? ['shift'] : [])
        ]
        contents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers })
        contents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers })
      },
      { key, shift, web }
    )
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const waitZoom = async (value) => {
    await page.waitForFunction(
      (value) => document.querySelector('#app-zoom-percent')?.value === String(value),
      value
    )
    await waitUntil(
      () =>
        JSON.parse(readFileSync(join(profile, '.tn-desk-config.json'), 'utf8')).appZoomPercent ===
        value
    )
    const factor = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
    )
    assert.ok(Math.abs(factor - value / 100) < 0.001)
    await page.waitForFunction(
      ({ width, factor }) => Math.abs(window.innerWidth - width / factor) <= 1,
      { width: baselineWidth, factor }
    )
  }
  await zoomKey('=', true)
  await waitZoom(110)
  assert.equal(await capsule.locator('output').innerText(), '110%')
  await zoomKey('-')
  await waitZoom(100)
  await zoomKey('=')
  await waitZoom(110)
  await zoomKey('0')
  await waitZoom(100)
  for (let i = 0; i < 3; i++) await zoomKey('=')
  await waitZoom(130)
  await zoomInput.fill('150')
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
    ),
    1.3
  )
  await zoomInput.press('Tab')
  await waitZoom(150)
  await zoomInput.fill('invalid')
  await zoomInput.press('Tab')
  await waitZoom(150)
  await zoomInput.fill('999')
  await zoomInput.press('Tab')
  await waitZoom(200)
  assert.equal(
    await settingsPanel.getByRole('button', { name: '放大应用', exact: true }).isDisabled(),
    true
  )
  await zoomKey('=')
  await waitZoom(200)
  await zoomInput.fill('1')
  await zoomInput.press('Tab')
  await waitZoom(50)
  assert.equal(
    await settingsPanel.getByRole('button', { name: '缩小应用', exact: true }).isDisabled(),
    true
  )
  await settingsPanel.getByRole('button', { name: '放大应用', exact: true }).click()
  await waitZoom(60)
  await zoomKey('0')
  await waitZoom(100)

  // Hover cancels auto-hide; leaving starts a new, complete three-second countdown.
  await zoomKey('=')
  await waitZoom(110)
  await capsule.hover()
  await page.waitForTimeout(3300)
  assert.equal(await capsule.isVisible(), true)
  await capsule.getByRole('button', { name: '放大应用', exact: true }).click()
  await waitZoom(120)
  await capsule.getByRole('button', { name: '缩小应用', exact: true }).click()
  await waitZoom(110)
  await capsule.getByRole('button', { name: '重置应用缩放' }).click()
  await waitZoom(100)
  await page.mouse.move(5, 5)
  await page.waitForTimeout(2200)
  assert.equal(await capsule.isVisible(), true)
  await capsule.waitFor({ state: 'hidden', timeout: 2000 })
  await zoomInput.fill('175')
  await page.locator('.settings-backdrop').click({ position: { x: 10, y: 10 } })
  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  await waitZoom(175)
  await zoomKey('0')
  await waitZoom(100)
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()

  // Native web views must share app zoom and track zoomed CSS bounds.
  await page.getByRole('button', { name: '只读视图', exact: true }).click()
  await page.getByRole('link', { name: 'Zoom web fixture', exact: true }).click()
  await page.locator('.web-viewport').waitFor()
  await page.waitForFunction(() =>
    document.querySelector('.browser-toolbar input')?.value.includes('127.0.0.1')
  )
  await zoomKey('=', false, true)
  await page.waitForFunction(
    () => document.querySelector('.zoom-percentage')?.textContent === '110%'
  )
  await page.waitForTimeout(250)
  const webBounds = await page.locator('.web-viewport').evaluate((element) => {
    const r = element.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  const nativeWeb = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const child = window.contentView.children[0]
    return {
      bounds: child.getBounds(),
      zoom: child.webContents.getZoomFactor(),
      visible: child.getVisible()
    }
  })
  assert.ok(Math.abs(nativeWeb.zoom - 1.1) < 0.001)
  for (const field of ['x', 'y', 'width', 'height']) {
    assert.ok(
      Math.abs(nativeWeb.bounds[field] - webBounds[field] * 1.1) <= 1,
      'native web bounds: ' + field
    )
  }
  assert.equal(nativeWeb.visible, true)
  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  await zoomKey('=')
  await waitZoom(120)
  await page.waitForTimeout(250)
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()
    ),
    false
  )
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await page.waitForTimeout(250)
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()
    ),
    true
  )
  await page.locator('.tab', { hasText: 'workspace-note' }).click()

  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  await zoomInput.fill('150')
  await zoomInput.press('Tab')
  await waitZoom(150)
  await page.reload()
  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  await waitZoom(150)
  await zoomKey('-')
  await waitZoom(140)
  await capsule.hover()
  const capsuleFits = await capsule.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return (
      rect.left >= 0 &&
      rect.right <= window.innerWidth &&
      rect.top >= 0 &&
      rect.bottom <= window.innerHeight
    )
  })
  assert.equal(capsuleFits, true)
  // CDP screenshots can crop the viewport at non-unit Electron zoom; capture the native frame.
  const frame = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].capturePage()
    return image.toPNG().toString('base64')
  })
  writeFileSync(join(shots, 'app-zoom-settings.png'), Buffer.from(frame, 'base64'))

  console.log(
    '✓ app-wide native zoom, settings, capsule timing/hover/reset, web-view bounds and persistence'
  )

  await zoomKey('0')
  await waitZoom(100)
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await page.locator('.tab', { hasText: 'workspace-note' }).click()
  await page.getByRole('button', { name: '可视化编辑', exact: true }).click()
  const codeGroup = page.locator('[data-type="desk-raw-block"][data-kind="raw-container"]').first()
  await codeGroup.hover({ position: { x: 10, y: 10 } })
  await waitForBlockControls(true)
  assert.equal(await blockHandle.locator('.operation-item:visible').count(), 1)
  assert.equal(await blockHandle.locator('.operation-item:first-child').isVisible(), false)
  await page.screenshot({ path: join(shots, 'single-block-handle.png') })
  await blockHandle.locator('.operation-item:last-child').click()
  const blockMenu = page.getByRole('menu', { name: '块操作' })
  await blockMenu.waitFor()
  await blockMenu.getByRole('menuitem', { name: /在下方添加/ }).hover()
  await page.locator('.milkdown-slash-menu').waitFor({ state: 'visible' })
  assert.equal(await blockMenu.isVisible(), true)
  await page.screenshot({ path: join(shots, 'single-block-handle-add-below.png') })
  console.log('✓ only the six-dot control is visible; its menu and add-below action still work')
} catch (error) {
  const page = await app.firstWindow()
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
  console.error('Fixture README:', readFileSync(join(note, 'README.md'), 'utf8'))
  throw error
} finally {
  await app.close()
  await new Promise((resolve) => webServer.close(resolve))
  rmSync(fixtureRoot, { recursive: true, force: true })
}
