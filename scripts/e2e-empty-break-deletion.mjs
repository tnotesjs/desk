// Runtime regression for todos/2026.08.29/0017.
// Reproduces three consecutive standalone <br /> lines in an isolated note.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const deskDir = '/Users/huyouda/tnotesjs/desk'
const fixtureRoot = mkdtempSync(join(tmpdir(), 'desk-empty-break-e2e-'))
const workspace = join(fixtureRoot, 'workspace')
const profile = join(fixtureRoot, 'profile')
const kb = join(workspace, 'TNotes.empty-break-e2e')
const note = join(kb, 'notes', '0001. empty breaks')
const readme = join(note, 'README.md')
const shots = join(deskDir, 'scripts', 'shots', 'empty-break-deletion')

mkdirSync(note, { recursive: true })
mkdirSync(profile, { recursive: true })
mkdirSync(shots, { recursive: true })

const kbConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground', 'TNotes.docs', '.tnotes.json'), 'utf8')
)
kbConfig.id = '00000000-0000-4000-8000-000000000017'
kbConfig.repoName = 'TNotes.empty-break-e2e'
kbConfig.sidebarShowNoteId = false
kbConfig.root_item = { ...kbConfig.root_item, title: 'empty-break-e2e', details: 'isolated e2e' }
writeFileSync(join(kb, '.tnotes.json'), `${JSON.stringify(kbConfig, null, 2)}\n`)
writeFileSync(join(kb, 'TOC.md'), '- [ ] 0001. empty breaks\n')
writeFileSync(
  join(kb, 'sidebar.json'),
  `${JSON.stringify(
    [
      {
        text: '⏰ empty breaks',
        link: '/notes/0001. empty breaks/README',
        tocLineIndex: 0,
        nodeId: 'note:0001'
      }
    ],
    null,
    2
  )}\n`
)
const noteConfig = JSON.parse(
  readFileSync(
    join(deskDir, 'playground', 'TNotes.docs', 'notes', '0041. new', '.tnotes.json'),
    'utf8'
  )
)
noteConfig.id = '00000000-0000-4000-8000-000000000018'
writeFileSync(join(note, '.tnotes.json'), `${JSON.stringify(noteConfig, null, 2)}\n`)
const originalSource =
  '# Empty break deletion\n\nbefore\n\n<br />\n\n<br />\n\n<br />\n\nafter\n\n<B id="readonly-e2e" />\n'
writeFileSync(readme, originalSource)
writeFileSync(
  join(profile, 'workspace.v1.json'),
  `${JSON.stringify({ path: workspace }, null, 2)}\n`
)
writeFileSync(
  join(profile, 'settings.json'),
  `${JSON.stringify(
    {
      version: 1,
      defaultNoteView: 'visual',
      theme: 'dark',
      autosave: { enabled: false, delayMs: 1000 }
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

try {
  const page = await app.firstWindow({ timeout: 30000 })
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize({ width: 1200, height: 760 })
  await page.getByText('empty-break-e2e', { exact: true }).first().waitFor({ timeout: 30000 })
  await page.getByText('empty-break-e2e', { exact: true }).first().click()
  await page.getByText('empty breaks', { exact: true }).first().click()

  const pm = page.locator('.milkdown .ProseMirror').first()
  const emptyLines = pm.locator('[data-type="desk-raw-block"][data-kind="raw-break"]')
  await emptyLines.first().waitFor({ timeout: 30000 })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  assert.equal(await emptyLines.count(), 3)
  assert.deepEqual(await emptyLines.allTextContents(), ['', '', ''])
  const initialPresentation = await emptyLines.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element)
      return {
        borderTopWidth: style.borderTopWidth,
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        height: element.getBoundingClientRect().height
      }
    })
  )
  for (const presentation of initialPresentation) {
    assert.equal(presentation.borderTopWidth, '0px')
    assert.equal(presentation.backgroundColor, 'rgba(0, 0, 0, 0)')
    assert.equal(presentation.boxShadow, 'none')
    assert.ok(presentation.height > 20 && presentation.height < 40)
  }
  await page.screenshot({ path: join(shots, '01-three-empty-lines.png') })

  const afterParagraph = pm
    .locator('p')
    .filter({ hasText: /^after$/ })
    .first()
  await afterParagraph.click({ position: { x: 1, y: 10 } })
  await page.keyboard.press('Home')
  const keyboardSelectedEmptyLines = pm.locator(
    '[data-type="desk-raw-block"][data-kind="raw-break"].desk-raw-block--range-selected'
  )
  for (const expected of [1, 2, 3]) {
    await page.keyboard.press('Shift+ArrowUp')
    const actual = await keyboardSelectedEmptyLines.count()
    const keyboardState = await pm.evaluate((element) => {
      const selection = document.getSelection()
      return {
        activeElement: document.activeElement?.className ?? document.activeElement?.tagName ?? null,
        selectedClasses: [...element.querySelectorAll('[data-kind="raw-break"]')].map(
          (line) => line.className
        ),
        selection: selection
          ? {
              collapsed: selection.isCollapsed,
              anchorNode: selection.anchorNode?.parentElement?.className ?? null,
              anchorOffset: selection.anchorOffset,
              focusNode: selection.focusNode?.parentElement?.className ?? null,
              focusOffset: selection.focusOffset
            }
          : null
      }
    })
    console.log(`keyboard-up-${expected}:`, JSON.stringify(keyboardState))
    assert.equal(actual, expected)
  }
  await page.screenshot({ path: join(shots, '02-three-empty-lines-keyboard-selected.png') })
  for (const expected of [2, 1, 0]) {
    await page.keyboard.press('Shift+ArrowDown')
    assert.equal(await keyboardSelectedEmptyLines.count(), expected)
  }

  const firstRangeBox = await emptyLines.first().boundingBox()
  const lastRangeBox = await emptyLines.last().boundingBox()
  assert.ok(firstRangeBox)
  assert.ok(lastRangeBox)
  await page.mouse.move(firstRangeBox.x + 3, firstRangeBox.y + firstRangeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(lastRangeBox.x + 12, lastRangeBox.y + lastRangeBox.height / 2, {
    steps: 12
  })
  await page.mouse.up()
  await page.waitForTimeout(80)

  const selectedEmptyLines = pm.locator(
    '[data-type="desk-raw-block"][data-kind="raw-break"].desk-raw-block--range-selected'
  )
  const rangeSelectionPresentation = await emptyLines.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element)
      const marker = getComputedStyle(element, '::before')
      return {
        selected: element.classList.contains('desk-raw-block--range-selected'),
        backgroundColor: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        markerContent: marker.content,
        markerWidth: Number.parseFloat(marker.width),
        markerHeight: Number.parseFloat(marker.height),
        markerBackground: marker.backgroundColor
      }
    })
  )
  assert.equal(await selectedEmptyLines.count(), 3)
  assert.equal(
    rangeSelectionPresentation.every(({ selected }) => selected),
    true
  )
  for (const presentation of rangeSelectionPresentation) {
    assert.equal(presentation.backgroundColor, 'rgba(0, 0, 0, 0)')
    assert.equal(presentation.borderTopWidth, '0px')
    assert.equal(presentation.boxShadow, 'none')
    assert.equal(presentation.markerContent, '""')
    assert.ok(presentation.markerWidth >= 7 && presentation.markerWidth <= 9)
    assert.ok(presentation.markerHeight >= 16 && presentation.markerHeight <= 24)
    assert.notEqual(presentation.markerBackground, 'rgba(0, 0, 0, 0)')
  }
  await page.screenshot({ path: join(shots, '03-three-empty-lines-pointer-selected.png') })

  const middle = emptyLines.nth(1)
  const box = await middle.boundingBox()
  assert.ok(box)
  await middle.click({ position: { x: Math.min(20, box.width / 2), y: box.height / 2 } })
  assert.equal(
    await middle.evaluate((element) => element.classList.contains('ProseMirror-selectednode')),
    true
  )
  const selectedPresentation = await middle.evaluate((element) => {
    const style = getComputedStyle(element)
    const caret = getComputedStyle(element, '::before')
    const placeholder = getComputedStyle(element, '::after')
    return {
      selectionActive: element.classList.contains('desk-raw-block--selection-active'),
      placeholderAttribute: element.getAttribute('data-placeholder'),
      borderTopWidth: style.borderTopWidth,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      caretWidth: caret.width,
      caretHeight: caret.height,
      caretContent: caret.content,
      caretBackground: caret.backgroundColor,
      placeholderContent: placeholder.content,
      placeholderColor: placeholder.color
    }
  })
  assert.equal(selectedPresentation.selectionActive, true)
  assert.equal(selectedPresentation.placeholderAttribute, '输入 / 插入内容')
  assert.equal(selectedPresentation.borderTopWidth, '0px')
  assert.equal(selectedPresentation.backgroundColor, 'rgba(0, 0, 0, 0)')
  assert.equal(selectedPresentation.boxShadow, 'none')
  assert.equal(selectedPresentation.caretContent, '""')
  assert.equal(selectedPresentation.caretWidth, '1px')
  assert.ok(Number.parseFloat(selectedPresentation.caretHeight) >= 16)
  assert.notEqual(selectedPresentation.caretBackground, 'rgba(0, 0, 0, 0)')
  assert.equal(selectedPresentation.placeholderContent, '"输入 / 插入内容"')
  assert.notEqual(selectedPresentation.placeholderColor, 'rgba(0, 0, 0, 0)')
  assert.equal(
    await page
      .locator('.prosemirror-virtual-cursor, .desk-raw-boundary-cursor, .ProseMirror-gapcursor')
      .count(),
    0
  )
  assert.equal(await selectedEmptyLines.count(), 0)
  const handleAlignment = await middle.evaluate((element) => {
    const line = element.getBoundingClientRect()
    const handle = document.querySelector('.milkdown-block-handle')?.getBoundingClientRect()
    return handle
      ? {
          lineCenter: line.top + line.height / 2,
          handleCenter: handle.top + handle.height / 2
        }
      : null
  })
  assert.ok(handleAlignment)
  console.log('raw-break-handle-alignment:', JSON.stringify(handleAlignment))
  assert.ok(Math.abs(handleAlignment.lineCenter - handleAlignment.handleCenter) <= 6)
  await page.screenshot({ path: join(shots, '04-middle-line-selected-with-hint.png') })

  await page.getByRole('button', { name: '只读视图', exact: true }).click()
  await page.waitForTimeout(120)
  assert.equal(await pm.getAttribute('contenteditable'), 'false')
  assert.equal(await page.locator('.milkdown-markdown-editor.is-readonly').count(), 1)
  const readonlyPresentation = await pm.evaluate((element) => {
    const caretElements = [
      ...document.querySelectorAll(
        '.prosemirror-virtual-cursor, .desk-raw-boundary-cursor, .desk-raw-selection-cursor, .ProseMirror-gapcursor, .crepe-drop-cursor'
      )
    ]
    const visibleCarets = caretElements.filter((caret) => {
      const style = getComputedStyle(caret)
      const rect = caret.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0
    }).length
    return {
      caretColor: getComputedStyle(element).caretColor,
      visibleCarets,
      focused: element.classList.contains('ProseMirror-focused'),
      activeInside: element.contains(document.activeElement)
    }
  })
  assert.equal(readonlyPresentation.caretColor, 'rgba(0, 0, 0, 0)')
  assert.equal(readonlyPresentation.visibleCarets, 0)
  assert.equal(readonlyPresentation.focused, false)
  assert.equal(readonlyPresentation.activeInside, false)
  assert.equal(await page.locator('.desk-raw-block--selection-active').count(), 0)

  await middle.click({ position: { x: Math.min(20, box.width / 2), y: box.height / 2 } })
  await page.keyboard.press('Delete')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText('readonly-should-not-appear')
  assert.equal(await emptyLines.count(), 3)
  const editButton = page.locator('.desk-raw-block__edit').first()
  assert.equal(await editButton.isVisible(), false)
  await editButton.dispatchEvent('click')
  assert.equal(await page.locator('.desk-raw-block__editor-cm:visible').count(), 0)
  await page.screenshot({ path: join(shots, '05-readonly-no-caret.png') })

  await page.getByRole('button', { name: '源码视图', exact: true }).click()
  const sourceContent = page.locator('.markdown-source-editor .cm-content').first()
  await sourceContent.waitFor()
  const sourceAfterReadonlyAttempts = await sourceContent.textContent()
  assert.equal(sourceAfterReadonlyAttempts.includes('readonly-should-not-appear'), false)
  assert.equal((sourceAfterReadonlyAttempts.match(/<br \/>/g) ?? []).length, 3)
  assert.equal(sourceAfterReadonlyAttempts.includes('<B id="readonly-e2e" />'), true)

  await page.getByRole('button', { name: '可视化编辑', exact: true }).click()
  await emptyLines.first().waitFor()
  const middleAfterReadonly = emptyLines.nth(1)
  const boxAfterReadonly = await middleAfterReadonly.boundingBox()
  assert.ok(boxAfterReadonly)
  await middleAfterReadonly.click({
    position: { x: Math.min(20, boxAfterReadonly.width / 2), y: boxAfterReadonly.height / 2 }
  })
  await page.keyboard.press('Delete')
  assert.equal(await emptyLines.count(), 2)
  await page.waitForTimeout(200)
  assert.equal(await emptyLines.count(), 2)
  await page.screenshot({ path: join(shots, '06-middle-line-deleted.png') })

  const save = page.getByRole('button', { name: '保存', exact: true })
  await save.click()
  await page.waitForTimeout(500)
  const saved = readFileSync(readme, 'utf8')
  assert.equal((saved.match(/<br \/>/g) ?? []).length, 2)
  assert.equal(saved.includes('before'), true)
  assert.equal(saved.includes('after'), true)
  console.log('✓ three empty lines render independently')
  console.log('✓ Shift+ArrowUp/Down expands and shrinks a three-line empty range')
  console.log('✓ dragging across three empty lines paints three compact range markers')
  console.log('✓ visual empty-line selection renders one in-row caret and input hint')
  console.log('✓ readonly mode shows no caret and rejects all attempted document edits')
  console.log('✓ Delete removes only the selected middle <br />')
  console.log('✓ saving persists exactly two <br /> lines')
} finally {
  await app.close()
  rmSync(fixtureRoot, { recursive: true, force: true })
}
