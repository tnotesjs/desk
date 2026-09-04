// Native shortcut coverage, isolated from the user's knowledge bases and profile.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const deskDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = mkdtempSync(join(tmpdir(), 'desk-clear-line-styles-'))
const workspace = join(fixture, 'workspace')
const profile = join(fixture, 'profile')
const kb = join(workspace, 'TNotes.clear-line-styles')
const note = join(kb, 'notes', '0001. styles')
const readme = join(note, 'README.md')
const shots = join(deskDir, 'scripts', 'shots', 'clear-line-styles')
mkdirSync(join(note, 'demos'), { recursive: true })
mkdirSync(profile, { recursive: true })
mkdirSync(shots, { recursive: true })
const kbConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/.tnotes.json'), 'utf8')
)
kbConfig.id = '10000000-0000-4000-8000-000000000051'
kbConfig.repoName = 'TNotes.clear-line-styles'
kbConfig.root_item = { ...kbConfig.root_item, title: 'clear-line-styles' }
writeFileSync(join(kb, '.tnotes.json'), JSON.stringify(kbConfig))
writeFileSync(join(kb, 'TOC.md'), '- [ ] 0001. styles\n')
writeFileSync(join(kb, 'sidebar.json'), '[]\n')
const noteConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/notes/0041. new/.tnotes.json'), 'utf8')
)
noteConfig.id = '10000000-0000-4000-8000-000000000052'
writeFileSync(join(note, '.tnotes.json'), JSON.stringify(noteConfig))
const source = [
  '# Styles',
  '',
  '**first** *italic* ~~strike~~ [link](https://example.com) `inline`',
  '',
  '**second** *italic* ~~strike~~',
  '',
  '## **Heading**',
  '',
  '**last**',
  '',
  '```md',
  '**literal** *code* ~~code~~',
  '```',
  ''
].join('\n')
writeFileSync(readme, source)
for (const path of ['other.md', 'demos/README.md']) writeFileSync(join(note, path), '**untouched**')
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
  await page.getByText('clear-line-styles', { exact: true }).first().click()
  await page.getByText('styles', { exact: true }).first().click()
  const pm = page.locator('.milkdown .ProseMirror')
  await pm.waitFor()
  // Use browser selection, not editor internals, then let ProseMirror observe it.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const select = async (start, end = start) => {
    await pm.evaluate(
      (root, { start, end }) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const nodes = []
        while (walker.nextNode()) nodes.push(walker.currentNode)
        const from = nodes.find((node) => node.textContent === start)
        const to = nodes.find((node) => node.textContent === end)
        if (!from || !to) throw new Error(`Missing selection text: ${start} / ${end}`)
        root.focus()
        const selection = window.getSelection()
        selection.setBaseAndExtent(from, 2, to, 2)
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      },
      { start, end }
    )
  }
  const first = pm.locator('p').filter({ hasText: 'first' })
  const second = pm.locator('p').filter({ hasText: 'second' })
  await select('first')
  await page.keyboard.press('ControlOrMeta+Backslash')
  await first.locator('strong').waitFor({ state: 'detached' })
  assert.equal(await first.locator('strong, em, del').count(), 0)
  assert.equal(await first.locator('a[href="https://example.com"]').count(), 1)
  assert.equal(await first.locator('code').innerText(), 'inline')
  assert.equal(await second.locator('strong, em, del').count(), 3)
  await page.keyboard.press('ControlOrMeta+z')
  await first.locator('strong').waitFor()
  await select('first', 'second')
  await page.keyboard.press('ControlOrMeta+Backslash')
  assert.equal(await first.locator('strong, em, del').count(), 0)
  assert.equal(await second.locator('strong, em, del').count(), 0)
  assert.equal(await pm.locator('h2 strong').innerText(), 'Heading')
  assert.equal(await pm.locator('p strong').last().innerText(), 'last')
  await page.keyboard.press('ControlOrMeta+z')
  await first.locator('strong').waitFor()
  await second.locator('strong').waitFor()
  console.log('✓ visual caret / multiline shortcut clears full lines; other styles and undo work')

  await page.getByRole('button', { name: '只读视图', exact: true }).click()
  await select('first', 'second')
  await page.keyboard.press('ControlOrMeta+Backslash')
  assert.equal(await first.locator('strong, em, del').count(), 3)
  assert.equal(await second.locator('strong, em, del').count(), 3)

  await page.getByRole('button', { name: '源码视图', exact: true }).click()
  const cm = page.locator('.markdown-source-editor .cm-content')
  await cm.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+Backslash')
  assert.match(
    await cm.innerText(),
    /first italic strike \[link\]\(https:\/\/example.com\) `inline`/
  )
  assert.match(await cm.innerText(), /second italic strike/)
  assert.match(await cm.innerText(), /## Heading/)
  assert.match(await cm.innerText(), /\*\*literal\*\* \*code\* ~~code~~/)
  await page.keyboard.press('ControlOrMeta+s')
  await page.locator('.tab .dirty-dot').waitFor({ state: 'detached' })
  const saved = readFileSync(readme, 'utf8')
  assert.match(saved, /first italic strike/)
  assert.match(saved, /second italic strike/)
  assert.match(saved, /```md\n\*\*literal\*\* \*code\* ~~code~~\n```/)
  console.log(
    '✓ source multiline shortcut saves valid Markdown, preserves literal code; read-only is inert'
  )

  const expand = page.getByRole('button', { name: '展开笔记文件', exact: true })
  if (await expand.isVisible()) await expand.click()
  const tree = page.locator('.note-file-sidebar')
  for (const path of ['other.md', 'demos/README.md']) {
    if (path.startsWith('demos/')) await tree.locator('.tree-row[title="demos"]').click()
    await tree.locator(`.tree-row[title="${path}"]`).click()
    const file = page.locator('.note-file-pane .cm-content:visible')
    await file.click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ControlOrMeta+Backslash')
    assert.equal(await file.innerText(), '**untouched**')
    assert.equal(readFileSync(join(note, path), 'utf8'), '**untouched**')
  }
  await page.screenshot({ path: join(shots, 'note-only-shortcut.png') })
  console.log('✓ other Markdown files and nested README.md do not receive the note-only shortcut')
} catch (error) {
  const page = await app.firstWindow()
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await app.close()
  rmSync(fixture, { recursive: true, force: true })
}
