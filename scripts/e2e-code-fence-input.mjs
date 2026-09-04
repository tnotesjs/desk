// Native typing coverage for the middle-dot code fence shortcut, in a temporary KB.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const deskDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = mkdtempSync(join(tmpdir(), 'desk-code-fence-input-'))
const workspace = join(fixture, 'workspace')
const profile = join(fixture, 'profile')
const kb = join(workspace, 'TNotes.code-fence-input')
const note = join(kb, 'notes', '0001. code-fence')
const readme = join(note, 'README.md')
const shots = join(deskDir, 'scripts', 'shots', 'code-fence-input')
mkdirSync(note, { recursive: true })
mkdirSync(profile, { recursive: true })
mkdirSync(shots, { recursive: true })
const kbConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/.tnotes.json'), 'utf8')
)
kbConfig.id = '10000000-0000-4000-8000-000000000041'
kbConfig.repoName = 'TNotes.code-fence-input'
kbConfig.root_item = { ...kbConfig.root_item, title: 'code-fence-input' }
writeFileSync(join(kb, '.tnotes.json'), JSON.stringify(kbConfig))
writeFileSync(join(kb, 'TOC.md'), '- [ ] 0001. code-fence\n')
writeFileSync(join(kb, 'sidebar.json'), '[]\n')
const noteConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/notes/0041. new/.tnotes.json'), 'utf8')
)
noteConfig.id = '10000000-0000-4000-8000-000000000042'
writeFileSync(join(note, '.tnotes.json'), JSON.stringify(noteConfig))
writeFileSync(readme, '# Code fence shortcut\n\n<br />\n')
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
  await page.getByText('code-fence-input', { exact: true }).first().click()
  await page.getByText('code-fence', { exact: true }).first().click()
  const pm = page.locator('.milkdown .ProseMirror')
  await pm.waitFor()
  await pm.locator(':scope > p').last().click()
  for (let count = 1; count <= 2; count += 1) {
    await page.keyboard.insertText('·')
    assert.equal(await pm.locator('.milkdown-code-block').count(), 0)
    assert.equal(await pm.locator(':scope > p').last().innerText(), '·'.repeat(count))
  }
  await page.keyboard.insertText('·')
  const code = pm.locator('.milkdown-code-block .cm-content')
  await code.waitFor()
  await page.waitForFunction(() =>
    document.activeElement?.matches('.milkdown-code-block .cm-content')
  )
  // CodeMirror renders an empty line as a <br>, whose innerText is a newline.
  assert.equal((await code.innerText()).trim(), '')
  await page.keyboard.type('const created = 1')
  assert.equal(await code.innerText(), 'const created = 1')
  await page.keyboard.press('ControlOrMeta+s')
  const deadline = Date.now() + 5000
  while (!readFileSync(readme, 'utf8').includes('const created = 1')) {
    if (Date.now() > deadline) throw new Error('Code block was not saved')
    await page.waitForTimeout(50)
  }
  assert.match(readFileSync(readme, 'utf8'), /```\nconst created = 1\n```/)
  assert.doesNotMatch(readFileSync(readme, 'utf8'), /·/)
  console.log(
    '✓ third dot creates code immediately, focuses CodeMirror, and saves standard Markdown fences'
  )

  await page.locator('.tab .dirty-dot').waitFor({ state: 'detached' })
  await code.click()
  await page.keyboard.press('ControlOrMeta+Enter')
  await pm.locator(':scope > p').last().click()
  await page.keyboard.insertText('···')
  await page.waitForFunction(() => document.querySelectorAll('.milkdown-code-block').length === 2)
  await page.waitForFunction(
    () =>
      document.activeElement ===
      [...document.querySelectorAll('.milkdown-code-block .cm-content')].at(-1)
  )
  await page.keyboard.insertText('···')
  assert.equal(await code.last().innerText(), '···')
  assert.equal(await pm.locator('.milkdown-code-block').count(), 2)
  await page.keyboard.press('ControlOrMeta+Enter')
  await pm.locator(':scope > p').last().click()
  await page.keyboard.insertText('正文···')
  assert.equal(await pm.locator(':scope > p').last().innerText(), '正文···')
  assert.equal(await pm.locator('.milkdown-code-block').count(), 2)
  await page.screenshot({ path: join(shots, 'middle-dot-code-block.png') })
  console.log('✓ batched text input also works; code and inline prose keep literal dots')
} catch (error) {
  const page = await app.firstWindow()
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await app.close()
  rmSync(fixture, { recursive: true, force: true })
}
