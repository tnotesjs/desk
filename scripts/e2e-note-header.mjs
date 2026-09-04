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
      const lastButton = await page.locator('.format-actions button').last().boundingBox()
      assert.ok(Math.abs(format.x + format.width - lastButton.x - lastButton.width - 12) < 1)
      const buttons = await page.locator('.format-actions button').evaluateAll((elements) =>
        elements.map((element) => ({
          label: element.getAttribute('aria-label'),
          fontSize: getComputedStyle(element).fontSize,
          height: element.getBoundingClientRect().height
        }))
      )
      assert.deepEqual(
        buttons.map((button) => button.label),
        [
          '粗体',
          '斜体',
          '删除线',
          '行内代码',
          '标题级别',
          '引用',
          '无序列表',
          '有序列表',
          '复选框',
          '链接',
          '代码块',
          '分割线',
          '表格'
        ]
      )
      assert.ok(buttons.every((button) => button.fontSize === '14px' && button.height === 32))
      const icons = await page.locator('.format-actions .format-icon').evaluateAll((elements) =>
        elements.map((element) => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          stroke: getComputedStyle(element).stroke,
          fill: element.querySelector('path:last-child').getAttribute('fill')
        }))
      )
      assert.equal(icons.length, 12)
      assert.ok(
        icons.every(
          (icon) =>
            icon.width === 18 &&
            icon.height === 18 &&
            icon.stroke === 'none' &&
            icon.fill === 'currentColor'
        )
      )
    }
    await page.screenshot({ path: join(shots, `${mode}.png`) })
  }
  console.log(
    '✓ title left; width | views right; formatting is right-aligned in a separate visual-only row; no save button'
  )

  await page.getByRole('button', { name: '可视化编辑', exact: true }).click()
  for (const [label, selector, shortcut] of [
    ['删除线', 'del', 'ControlOrMeta+Shift+x'],
    ['行内代码', 'code', 'ControlOrMeta+e']
  ]) {
    await pm.evaluate((root) => {
      const paragraph = [...root.querySelectorAll('p')].find(
        (node) => node.textContent === 'Initial content.'
      )
      root.focus()
      window.getSelection().setBaseAndExtent(paragraph.firstChild, 0, paragraph.firstChild, 7)
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    const button = page.locator('.format-actions').getByRole('button', { name: label, exact: true })
    await button.click()
    await pm.locator(`p ${selector}`).waitFor()
    assert.equal(await pm.locator(`p ${selector}`).innerText(), 'Initial')
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'Initial')
    await page.keyboard.press(shortcut)
    await pm.locator(`p ${selector}`).waitFor({ state: 'detached' })
    await button.click()
    await pm.locator(`p ${selector}`).waitFor()
    await button.click()
    await pm.locator(`p ${selector}`).waitFor({ state: 'detached' })
    assert.equal(await pm.locator('p').last().innerText(), 'Initial content.')
  }
  console.log(
    '✓ larger toolbar icons and strike/code ordering; buttons and shortcuts toggle marks without losing selected text'
  )

  const headingTrigger = page.getByRole('button', { name: '标题级别', exact: true })
  const generatedTitle = await pm.locator('h1').innerText()
  await pm.getByText('Initial content.', { exact: true }).click()
  const headingWidth = (await headingTrigger.boundingBox()).width
  assert.equal(headingWidth, 64)
  const nextButtonX = (await page.getByRole('button', { name: '引用', exact: true }).boundingBox())
    .x
  await headingTrigger.hover()
  const headingMenu = page.getByRole('menu', { name: '标题级别', exact: true })
  await headingMenu.waitFor()
  assert.equal(await pm.evaluate((root) => document.activeElement === root), true)
  await headingMenu.getByRole('menuitemradio', { name: '标题 3', exact: true }).hover()
  // Cross the trigger/menu gap and remain in the dropdown beyond its close delay.
  await page.waitForTimeout(250)
  assert.equal(await headingMenu.isVisible(), true)
  await pm.getByText('Initial content.', { exact: true }).hover()
  await headingMenu.waitFor({ state: 'detached' })
  assert.equal(await pm.evaluate((root) => document.activeElement === root), true)
  for (const level of [2, 3, 4, 5, 6, 0]) {
    await headingTrigger.click()
    const menu = page.getByRole('menu', { name: '标题级别', exact: true })
    assert.equal(await menu.getByRole('menuitemradio').count(), 6)
    assert.equal(await menu.getByRole('menuitemradio', { name: '标题 1', exact: true }).count(), 0)
    if (level === 2) await page.screenshot({ path: join(shots, 'heading-menu.png') })
    await menu
      .getByRole('menuitemradio', { name: level === 0 ? '正文' : `标题 ${level}`, exact: true })
      .click()
    await pm
      .locator(level === 0 ? 'p' : `h${level}`)
      .filter({ hasText: 'Initial content.' })
      .waitFor()
    assert.equal(await headingTrigger.innerText(), level === 0 ? '正文' : `H${level}`)
    assert.equal((await headingTrigger.boundingBox()).width, headingWidth)
    assert.equal(
      (await page.getByRole('button', { name: '引用', exact: true }).boundingBox()).x,
      nextButtonX
    )
    assert.equal(await page.getByRole('menu', { name: '标题级别', exact: true }).count(), 0)
    assert.equal(await pm.evaluate((root) => document.activeElement === root), true)
  }
  // The menu labels use the editor's existing native heading shortcuts.
  for (const level of [2, 3, 4, 5, 6, 0]) {
    await page.keyboard.press(`Alt+ControlOrMeta+${level}`)
    await pm
      .locator(level === 0 ? 'p' : `h${level}`)
      .filter({ hasText: 'Initial content.' })
      .waitFor()
    assert.equal(await headingTrigger.innerText(), level === 0 ? '正文' : `H${level}`)
  }
  await headingTrigger.click()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('menu', { name: '标题级别', exact: true }).count(), 0)
  assert.equal(await pm.locator('h1').count(), 1)
  assert.equal(await pm.locator('h1').innerText(), generatedTitle)
  console.log(
    '✓ heading dropdown and shortcuts apply paragraph/H2–H6 at the original caret; generated H1 is unchanged'
  )

  await pm.evaluate((root) => {
    const first = root.querySelector('h2').firstChild
    const last = [...root.querySelectorAll('p')].find(
      (node) => node.textContent === 'Initial content.'
    ).firstChild
    root.focus()
    window.getSelection().setBaseAndExtent(first, 0, last, last.textContent.length)
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await headingTrigger.click()
  await page.getByRole('menuitemradio', { name: '标题 4', exact: true }).click()
  assert.equal(await pm.locator('h4').count(), 2)
  await headingTrigger.click()
  await page.getByRole('menuitemradio', { name: '正文', exact: true }).click()
  assert.equal(await pm.locator('h4').count(), 0)
  await pm.getByText('正文', { exact: true }).click()
  await pm.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await headingTrigger.focus()
  await headingTrigger.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await pm.locator('h2').filter({ hasText: '正文' }).waitFor()
  assert.equal(await pm.locator('h2').count(), 1)
  assert.equal(await pm.locator('h1').innerText(), generatedTitle)
  console.log(
    '✓ multiline selection is retained by the menu; arrow keys and Enter apply the chosen level'
  )

  for (const [label, selector] of [
    ['有序列表', 'ol li'],
    ['复选框', 'li:has(> .label-wrapper .unchecked)'],
    ['分割线', 'hr']
  ]) {
    await pm.getByText('Initial content.', { exact: true }).click()
    await page.keyboard.press('End')
    await page.locator('.format-actions').getByRole('button', { name: label, exact: true }).click()
    await pm.locator(selector).waitFor()
    if (label !== '分割线')
      assert.match(await pm.locator(selector).innerText(), /Initial content\./)
    assert.match(await pm.innerText(), /Initial content\./)
    await page.keyboard.press('ControlOrMeta+z')
    await pm.locator(selector).waitFor({ state: 'detached' })
  }
  console.log('✓ ordered list, task checkbox and divider actions work; undo preserves note content')

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

  // Validate disk serialization separately: Core's save-time normalization is
  // itself undoable and must not be conflated with undoing the toolbar action.
  await pm.getByText(/KEEP-DRAFT/).click()
  await page.locator('.format-actions').getByRole('button', { name: '复选框', exact: true }).click()
  await pm.locator('li .unchecked').waitFor()
  await page.keyboard.press('ControlOrMeta+s')
  await waitUntil(() =>
    /^- \[ \] .*KEEP-DRAFT/m.test(readFileSync(join(finalNote, 'README.md'), 'utf8'))
  )
  await pm.locator('li .unchecked').click()
  await pm.locator('li .checked').waitFor()
  await page.keyboard.press('ControlOrMeta+s')
  await waitUntil(() =>
    /^- \[x\] .*KEEP-DRAFT/m.test(readFileSync(join(finalNote, 'README.md'), 'utf8'))
  )
  console.log(
    '✓ task checkboxes save as native GFM Markdown and support checked/unchecked interaction'
  )

  // Exercise the real toolbar and slash entry points, not just their shared command.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const focusEmptyParagraph = async () => {
    const last = pm.locator(':scope > p').last()
    await last.click()
    await page.keyboard.press('End')
    if ((await last.textContent())?.length) await page.keyboard.press('Enter')
    await pm.locator(':scope > p').last().click()
  }
  await focusEmptyParagraph()
  await page.locator('.format-actions').getByRole('button', { name: '表格', exact: true }).click()
  await pm.locator('table.children').waitFor()
  await focusEmptyParagraph()
  await page.keyboard.type('/')
  const slashMenu = page.locator('.milkdown-slash-menu')
  await slashMenu.waitFor({ state: 'visible' })
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const svgShape = async (locator) =>
    locator.evaluate((svg) => ({
      viewBox: svg.getAttribute('viewBox'),
      paths: [...svg.querySelectorAll('path')].map((path) => ({
        d: path.getAttribute('d'),
        fill: path.getAttribute('fill')
      }))
    }))
  for (const [slashLabel, toolbarLabel] of [
    ['Quote', '引用'],
    ['Divider', '分割线'],
    ['Bullet List', '无序列表'],
    ['Ordered List', '有序列表'],
    ['Task List', '复选框'],
    ['Code', '代码块'],
    ['Table', '表格']
  ]) {
    const item = slashMenu
      .locator('li[data-index]')
      .filter({ hasText: new RegExp(`^${slashLabel}$`) })
    const button = page.locator('.format-actions').getByRole('button', {
      name: toolbarLabel,
      exact: true
    })
    assert.deepEqual(await svgShape(item.locator('svg')), await svgShape(button.locator('svg')))
  }
  await page.screenshot({ path: join(shots, 'slash-shared-icons.png') })
  await page.keyboard.type('table')
  await slashMenu
    .locator('li[data-index]')
    .filter({ hasText: /^Table$/ })
    .click()
  await slashMenu.waitFor({ state: 'hidden' })
  const tables = await pm
    .locator('table.children')
    .evaluateAll((elements) =>
      elements.map((table) =>
        [...table.rows].map((row) =>
          [...row.cells].map((cell) => ({ tag: cell.tagName, text: cell.textContent }))
        )
      )
    )
  assert.equal(tables.length, 2)
  assert.deepEqual(tables[0], [
    [
      { tag: 'TH', text: '' },
      { tag: 'TH', text: '' }
    ],
    [
      { tag: 'TD', text: '' },
      { tag: 'TD', text: '' }
    ]
  ])
  assert.deepEqual(tables[1], tables[0])
  assert.equal((await pm.innerText()).includes('/table'), false)
  await page.keyboard.press('ControlOrMeta+s')
  await waitUntil(
    () =>
      (readFileSync(join(finalNote, 'README.md'), 'utf8').match(/^\|[^\n]*\|$/gm) ?? []).length ===
      6
  )
  await page.screenshot({ path: join(shots, 'matching-tables.png') })
  console.log('✓ slash and toolbar share seven icons and insert identical empty 2×2 tables')

  // Crepe uses its outline token for table icons; Desk's outline is a subtle
  // border color. Verify real menu contrast so that mapping cannot regress.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const luminance = (color) => {
    const channels = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
    const linear = channels.map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const assertMenuContrast = async (menu, theme) => {
    const styles = await menu.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      icons: [...element.querySelectorAll('button svg')].map((svg) => getComputedStyle(svg).fill)
    }))
    for (const color of styles.icons) {
      const foreground = luminance(color)
      const background = luminance(styles.background)
      const ratio =
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
      assert.ok(
        ratio >= 4.5,
        `${theme} table menu contrast ${ratio.toFixed(2)}: ${color} on ${styles.background}`
      )
    }
  }
  const tableBlock = pm.locator('.milkdown-table-block').last()
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
    }, theme)
    for (const axis of ['col', 'row']) {
      await tableBlock.locator('table.children td').last().hover()
      const handle = tableBlock.locator(`[data-role="${axis}-drag-handle"]`)
      await tableBlock.locator(`[data-role="${axis}-drag-handle"][data-show="true"]`).waitFor()
      await handle.click()
      const menu = handle.locator('.button-group[data-show="true"]')
      await menu.waitFor({ state: 'visible' })
      assert.equal(await menu.locator('button').count(), axis === 'col' ? 4 : 1)
      await assertMenuContrast(menu, `${theme}/${axis}/normal`)
      await menu.locator('button').first().hover()
      await assertMenuContrast(menu, `${theme}/${axis}/hover`)
      await page.screenshot({ path: join(shots, `table-menu-${axis}-${theme}.png`) })
    }
  }
  console.log('✓ table row/column menus stay readable in dark/light themes, including hover')
} catch (error) {
  const page = await app.firstWindow()
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await app.close()
  rmSync(fixture, { recursive: true, force: true })
}
