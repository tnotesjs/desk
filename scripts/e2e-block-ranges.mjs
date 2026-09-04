// Native Shift+arrow ranges across tables and embedded blocks, in an isolated KB.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const deskDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = mkdtempSync(join(tmpdir(), 'desk-block-ranges-'))
const workspace = join(fixture, 'workspace')
const profile = join(fixture, 'profile')
const kb = join(workspace, 'TNotes.block-ranges')
const note = join(kb, 'notes', '0001. block-ranges')
const readme = join(note, 'README.md')
const shots = join(deskDir, 'scripts', 'shots', 'block-ranges')
mkdirSync(note, { recursive: true })
mkdirSync(profile, { recursive: true })
mkdirSync(shots, { recursive: true })
const kbConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/.tnotes.json'), 'utf8')
)
kbConfig.id = '10000000-0000-4000-8000-000000000051'
kbConfig.repoName = 'TNotes.block-ranges'
kbConfig.root_item = { ...kbConfig.root_item, title: 'block-ranges' }
writeFileSync(join(kb, '.tnotes.json'), JSON.stringify(kbConfig))
writeFileSync(join(kb, 'TOC.md'), '- [ ] 0001. block-ranges\n')
writeFileSync(join(kb, 'sidebar.json'), '[]\n')
const noteConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/notes/0041. new/.tnotes.json'), 'utf8')
)
noteConfig.id = '10000000-0000-4000-8000-000000000052'
writeFileSync(join(note, '.tnotes.json'), JSON.stringify(noteConfig))
writeFileSync(
  join(note, 'pixel.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="gray"/></svg>'
)
writeFileSync(
  readme,
  [
    '# Block ranges',
    '',
    'TABLE-BEFORE',
    '',
    '| Header A | Header B |',
    '| --- | --- |',
    '| Cell A | Cell B |',
    '',
    'TABLE-AFTER',
    '',
    'FOLLOW-UP',
    '',
    'RAW-BEFORE',
    '',
    '::: info Selected raw',
    '',
    'ATOMIC-BODY',
    '',
    ':::',
    '',
    'RAW-AFTER',
    '',
    'CODE-BEFORE',
    '',
    '```js',
    'const selectedCode = 1',
    '```',
    '',
    'CODE-AFTER',
    '',
    'IMAGE-BEFORE',
    '',
    '![Image](./pixel.svg)',
    '',
    'IMAGE-AFTER',
    '',
    'CHAIN-BEFORE',
    '',
    '| Chain A | Chain B |',
    '| --- | --- |',
    '| Chain C | Chain D |',
    '',
    '::: info Chained raw',
    '',
    'CHAIN-ATOM',
    '',
    ':::',
    '',
    '```js',
    'const chained = 2',
    '```',
    '',
    'CHAIN-AFTER',
    '',
    'WRAP-START ' + 'wrapping content '.repeat(100) + 'WRAP-END',
    '',
    '| Wrap A | Wrap B |',
    '| --- | --- |',
    '| Wrap C | Wrap D |',
    '',
    'WRAP-AFTER',
    ''
  ].join('\n')
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

try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('block-ranges', { exact: true }).first().click()
  await page.locator('.toc-nodes .node-label').filter({ hasText: 'block-ranges' }).click()
  const pm = page.locator('.milkdown .ProseMirror')
  await pm.waitFor()
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const settle = async () =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    )
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const caret = async (text, offset = 'end') => {
    const paragraph = pm.locator(':scope > p').filter({ hasText: text })
    await paragraph.scrollIntoViewIfNeeded()
    await paragraph.click()
    await paragraph.evaluate((element, offset) => {
      const node = element.firstChild
      const pos = offset === 'end' ? node.textContent.length : offset
      window.getSelection().setBaseAndExtent(node, pos, node, pos)
    }, offset)
    await settle()
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const press = async (key) => {
    await page.keyboard.press(key)
    await settle()
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const selectionText = async () => page.evaluate(() => window.getSelection().toString())
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const assertCaret = async (text, offset = text.length) => {
    const actual = await page.evaluate(() => {
      const selection = window.getSelection()
      return {
        collapsed: selection.isCollapsed,
        text: selection.focusNode?.textContent,
        offset: selection.focusOffset
      }
    })
    assert.deepEqual(actual, { collapsed: true, text, offset })
  }

  for (const [before, after, selector] of [
    ['TABLE-BEFORE', 'TABLE-AFTER', '.milkdown-table-block'],
    ['RAW-BEFORE', 'RAW-AFTER', '.desk-raw-block--container'],
    ['CODE-BEFORE', 'CODE-AFTER', '.milkdown-code-block'],
    ['IMAGE-BEFORE', 'IMAGE-AFTER', ':scope > p:has(img)']
  ]) {
    const block = pm.locator(selector).first()
    await caret(before)
    await press('Shift+ArrowDown')
    assert.equal(
      await block.evaluate((el) => el.classList.contains('desk-block--range-selected')),
      true
    )
    assert.equal((await selectionText()).includes(after), false)
    await press('Shift+ArrowDown')
    assert.ok(
      (await selectionText()).includes(after),
      `${before}: second press reaches following text`
    )
    if (before === 'TABLE-BEFORE') {
      // A native text-only step after the intercepted block steps must also
      // be reversible without jumping back through the table.
      await press('Shift+ArrowDown')
      assert.ok((await selectionText()).includes('FOLLOW-UP'))
      await press('Shift+ArrowUp')
      assert.ok((await selectionText()).includes(after))
      assert.equal((await selectionText()).includes('FOLLOW-UP'), false)
    }
    await press('Shift+ArrowUp')
    assert.equal((await selectionText()).includes(after), false)
    assert.equal(
      await block.evaluate((el) => el.classList.contains('desk-block--range-selected')),
      true
    )
    await press('Shift+ArrowUp')
    await assertCaret(before)
    assert.equal(await pm.locator('.desk-block--range-selected').count(), 0)
    await caret(after, 0)
    await press('Shift+ArrowUp')
    assert.equal(
      await block.evaluate((el) => el.classList.contains('desk-block--range-selected')),
      true
    )
    await press('Shift+ArrowDown')
    await assertCaret(after, 0)
  }
  console.log(
    '✓ table, raw and code blocks select as whole blocks in both directions and reverse one step at a time'
  )

  await caret('CHAIN-BEFORE')
  for (let count = 1; count <= 3; count += 1) {
    await press('Shift+ArrowDown')
    assert.equal(await pm.locator('.desk-block--range-selected').count(), count)
  }
  await press('Shift+ArrowDown')
  assert.ok((await selectionText()).includes('CHAIN-AFTER'))
  await page.screenshot({ path: join(shots, 'consecutive-blocks.png') })
  await press('Shift+ArrowUp')
  for (let count = 2; count >= 0; count -= 1) {
    await press('Shift+ArrowUp')
    assert.equal(await pm.locator('.desk-block--range-selected').count(), count)
  }
  await assertCaret('CHAIN-BEFORE')
  console.log(
    '✓ consecutive table/raw/code blocks each take one step; reversal restores the original caret'
  )

  await caret('WRAP-START', 0)
  await press('Shift+ArrowDown')
  assert.equal(await pm.locator('.desk-block--range-selected').count(), 0)
  const firstLine = await selectionText()
  assert.ok(firstLine.length > 0 && !firstLine.includes('WRAP-END'))
  await caret('WRAP-START')
  await press('Shift+ArrowDown')
  assert.equal(await pm.locator('.milkdown-table-block.desk-block--range-selected').count(), 1)
  await press('Shift+ArrowUp')
  await assertCaret('WRAP-START ' + 'wrapping content '.repeat(100) + 'WRAP-END')
  console.log('✓ soft-wrapped paragraphs retain visual-line movement until the last line')

  const table = pm.locator('.milkdown-table-block').first()
  const cell = table.locator('table.children td').first().locator('p')
  await cell.click()
  await press('Home')
  await press('Shift+ArrowDown')
  assert.equal(await pm.locator('.desk-block--range-selected').count(), 0)
  assert.equal((await selectionText()).includes('TABLE-AFTER'), false)
  console.log('✓ starting inside a table retains cell/text selection')

  await caret('TABLE-BEFORE')
  await press('Shift+ArrowDown')
  await press('ControlOrMeta+c')
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert.match(copied, /Header A/)
  assert.match(copied, /Cell B/)
  assert.doesNotMatch(copied, /TABLE-AFTER|TABLE-BEFORE/)
  await page.screenshot({ path: join(shots, 'table-range.png') })
  await press('Shift+ArrowUp')
  await assertCaret('TABLE-BEFORE')
  await press('Shift+ArrowDown')
  await press('Backspace')
  assert.equal(await pm.locator('.milkdown-table-block').count(), 2)
  assert.ok((await pm.innerText()).includes('TABLE-BEFORE'))
  assert.ok((await pm.innerText()).includes('TABLE-AFTER'))
  await press('ControlOrMeta+z')
  assert.equal(await pm.locator('.milkdown-table-block').count(), 3)
  await caret('TABLE-BEFORE')
  await press('Shift+ArrowDown')
  await press('ControlOrMeta+x')
  assert.equal(await pm.locator('.milkdown-table-block').count(), 2)
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), copied)
  await press('ControlOrMeta+z')
  assert.equal(await pm.locator('.milkdown-table-block').count(), 3)
  console.log(
    '✓ copy/cut/delete cover the full table, preserve surrounding text, and undo restores it'
  )

  await caret('RAW-BEFORE')
  await press('Shift+ArrowDown')
  await press('ControlOrMeta+c')
  const rawCopy = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert.match(rawCopy, /::: info Selected raw/)
  assert.match(rawCopy, /ATOMIC-BODY/)
  assert.doesNotMatch(rawCopy, /RAW-BEFORE|RAW-AFTER/)
  await caret('CODE-BEFORE')
  await press('Shift+ArrowDown')
  await press('ControlOrMeta+c')
  const codeCopy = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert.match(codeCopy, /```js/)
  assert.match(codeCopy, /const selectedCode = 1/)
  assert.doesNotMatch(codeCopy, /CODE-BEFORE|CODE-AFTER/)
  console.log('✓ raw/code ranges copy canonical Markdown, not their preview UI')
} catch (error) {
  const page = await app.firstWindow()
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await app.close()
  rmSync(fixture, { recursive: true, force: true })
}
