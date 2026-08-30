// Runtime regression: consecutive standalone <br /> map to Milkdown empty
// paragraphs via remark-preserve-empty-line (same as the official playground).
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const deskDir = join(dirname(fileURLToPath(import.meta.url)), '..')
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
  await pm.waitFor({ timeout: 30000 })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })

  const emptyCount = await page.evaluate(() => {
    const root = document.querySelector('.milkdown .ProseMirror')
    if (!root) return 0
    return [...root.querySelectorAll(':scope > p')].filter(
      (element) => (element.textContent ?? '').trim() === ''
    ).length
  })
  assert.ok(emptyCount >= 3, `expected >= 3 empty paragraphs, got ${emptyCount}`)
  // Only the trailing <B /> component should be a desk raw atom.
  assert.equal(await pm.locator('[data-type="desk-raw-block"]').count(), 1)
  await page.screenshot({ path: join(shots, '01-three-empty-lines.png') })
  console.log('✓ consecutive standalone <br /> render as empty paragraphs')

  const middle = await page.evaluateHandle(() => {
    const root = document.querySelector('.milkdown .ProseMirror')
    const empties = [...root.querySelectorAll(':scope > p')].filter(
      (element) => (element.textContent ?? '').trim() === ''
    )
    return empties[1] ?? null
  })
  const middleElement = middle.asElement()
  assert.ok(middleElement)
  const box = await middleElement.boundingBox()
  assert.ok(box)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(100)

  const focusedEmpty = await page.evaluate(() => {
    const selection = document.getSelection()
    const node = selection?.anchorNode
    const paragraph =
      node instanceof Element ? node.closest('p') : node?.parentElement?.closest('p')
    return {
      isEmptyParagraph: Boolean(paragraph && (paragraph.textContent ?? '').trim() === ''),
      selectionCollapsed: selection?.isCollapsed ?? false
    }
  })
  assert.equal(focusedEmpty.isEmptyParagraph, true)
  assert.equal(focusedEmpty.selectionCollapsed, true)
  await page.screenshot({ path: join(shots, '04-middle-empty-paragraph-focused.png') })
  console.log('✓ clicking a middle empty paragraph places a native caret')

  await page.getByRole('button', { name: '只读视图', exact: true }).click()
  await page.waitForTimeout(120)
  assert.equal(await pm.getAttribute('contenteditable'), 'false')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText('readonly-should-not-appear')
  await page.screenshot({ path: join(shots, '05-readonly-no-caret.png') })

  await page.getByRole('button', { name: '源码视图', exact: true }).click()
  const sourceContent = page.locator('.markdown-source-editor .cm-content').first()
  await sourceContent.waitFor()
  const sourceAfterReadonlyAttempts = await sourceContent.textContent()
  assert.equal(sourceAfterReadonlyAttempts.includes('readonly-should-not-appear'), false)
  assert.equal((sourceAfterReadonlyAttempts.match(/<br \/>/g) ?? []).length, 3)

  await page.getByRole('button', { name: '可视化编辑', exact: true }).click()
  await pm.waitFor()
  const middleAfterReadonly = await page.evaluateHandle(() => {
    const root = document.querySelector('.milkdown .ProseMirror')
    const empties = [...root.querySelectorAll(':scope > p')].filter(
      (element) => (element.textContent ?? '').trim() === ''
    )
    return empties[1] ?? null
  })
  const middleAfterElement = middleAfterReadonly.asElement()
  assert.ok(middleAfterElement)
  const boxAfter = await middleAfterElement.boundingBox()
  assert.ok(boxAfter)
  await page.mouse.click(boxAfter.x + boxAfter.width / 2, boxAfter.y + boxAfter.height / 2)
  await page.keyboard.press('Delete')
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(shots, '06-middle-line-deleted.png') })

  const save = page.getByRole('button', { name: '保存', exact: true })
  await save.click()
  await page.waitForTimeout(500)
  const saved = readFileSync(readme, 'utf8')
  assert.equal((saved.match(/<br \/>/g) ?? []).length, 2)
  assert.equal(saved.includes('before'), true)
  assert.equal(saved.includes('after'), true)
  console.log('✓ readonly mode rejects edits')
  console.log('✓ Delete removes one empty paragraph and save keeps two <br /> lines')
} finally {
  await app.close()
  rmSync(fixtureRoot, { recursive: true, force: true })
}
