// E2E: launch desk (built output) via Playwright Electron, open 3 random notes, screenshot each.
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const DESK_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE = '/tmp/desk-e2e-profile-notes'
const SHOTS = join(DESK_DIR, 'scripts/shots/notes')
mkdirSync(SHOTS, { recursive: true })

// Pre-seed an isolated user-data dir so the single-instance lock does not collide
// with a running desk dev instance. Workspace points at the playground repo.
mkdirSync(PROFILE, { recursive: true })
writeFileSync(
  join(PROFILE, 'workspace.v1.json'),
  JSON.stringify({ path: join(DESK_DIR, 'playground') }, null, 2) + '\n'
)

const app = await _electron.launch({
  executablePath: electronPath,
  args: ['out/main/index.js', `--user-data-dir=${PROFILE}`],
  cwd: DESK_DIR,
  timeout: 60000,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})

// This is a plain JS (.mjs) Playwright helper; the TS-only return-type rule is
// not applicable to it, so opting out for this function.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function pickRandom(items, n) {
  const pool = [...items]
  const out = []
  while (out.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length)
    out.push(pool.splice(i, 1)[0])
  }
  return out
}

try {
  const win = await app.firstWindow({ timeout: 30000 })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  // 1) select the "docs" knowledge base
  const docs = win.locator('.knowledge-item', { hasText: 'docs' }).first()
  await docs.click({ timeout: 15000 })
  await win.waitForTimeout(2000)

  // 2) expand every group so all note rows are in the DOM
  const disclosure = win.locator('.toc-row .disclosure')
  const disclosureCount = await disclosure.count()
  for (let i = 0; i < disclosureCount; i++) {
    const d = disclosure.nth(i)
    if ((await d.getAttribute('aria-label')) === '展开') {
      await d.click().catch(() => {})
    }
  }
  await win.waitForTimeout(1200)

  // 3) gather visible note rows
  const rows = win.locator('.toc-row[data-note-uuid]')
  const rowCount = await rows.count()
  const visible = []
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i)
    if (await row.isVisible().catch(() => false)) visible.push(row)
  }
  if (visible.length < 3) {
    throw new Error(`Only ${visible.length} visible note row(s); cannot open 3 notes`)
  }

  const chosen = pickRandom(visible, 3)
  const opened = []
  for (let k = 0; k < chosen.length; k++) {
    const row = chosen[k]
    const label = row.locator('.node-label').first()
    const titleText = ((await label.innerText()) || '').trim()
    const noteUuid = await row.getAttribute('data-note-uuid')
    await label.click({ timeout: 15000 })
    await win.waitForTimeout(2500)
    const file = join(SHOTS, `random-${k + 1}.png`)
    await win.screenshot({ path: file })
    opened.push({ k: k + 1, titleText, noteUuid, file })
  }

  console.log('OPENED_NOTES=' + JSON.stringify(opened, null, 2))
} finally {
  await app.close()
}
