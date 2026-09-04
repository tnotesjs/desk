// Verify local VitePress fonts and note typography without any network access.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const deskDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = mkdtempSync(join(tmpdir(), 'desk-typography-'))
const workspace = join(fixture, 'workspace')
const profile = join(fixture, 'profile')
const kb = join(workspace, 'TNotes.typography')
const note = join(kb, 'notes', '0001. typography')
const shots = join(deskDir, 'scripts', 'shots', 'typography')
mkdirSync(note, { recursive: true })
mkdirSync(profile, { recursive: true })
mkdirSync(shots, { recursive: true })
const kbConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/.tnotes.json'), 'utf8')
)
kbConfig.id = '10000000-0000-4000-8000-000000000071'
kbConfig.repoName = 'TNotes.typography'
kbConfig.root_item = { ...kbConfig.root_item, title: 'typography' }
writeFileSync(join(kb, '.tnotes.json'), JSON.stringify(kbConfig))
writeFileSync(join(kb, 'TOC.md'), '- [ ] 0001. typography\n')
writeFileSync(join(kb, 'sidebar.json'), '[]\n')
const noteConfig = JSON.parse(
  readFileSync(join(deskDir, 'playground/TNotes.docs/notes/0041. new/.tnotes.json'), 'utf8')
)
noteConfig.id = '10000000-0000-4000-8000-000000000072'
writeFileSync(join(note, '.tnotes.json'), JSON.stringify(noteConfig))
const source = [
  '# 0001. 使用 contextBridge 暴露 API 给渲染进程',
  '',
  '<!-- region:toc -->',
  '- [1. 本节内容](#1-本节内容)',
  '- [2. demos.1 - 使用 contextBridge 暴露 API 给渲染进程](#2-demos1---使用-contextbridge-暴露-api-给渲染进程)',
  '<!-- endregion:toc -->',
  '',
  '## 1. 本节内容',
  '',
  '这一节将介绍如何在开启 `contextIsolation` 的情况下，使用 `contextBridge` 给渲染进程暴露 Electron API，使用系统的原生能力。',
  '',
  '普通 Inter Café Ā Ω ἄ Д Ѡ ắ；**加粗 Bold**；*斜体 Italic*；**_粗斜体 Bold Italic_**。',
  '',
  '- 顶层列表',
  '  - 嵌套列表',
  '    - [三级链接列表](https://example.com/nested)',
  '- **加粗列表**',
  '- [只含链接的列表](https://example.com)',
  '',
  '## 2. demos.1 - 使用 contextBridge 暴露 API 给渲染进程',
  '',
  '```js',
  'const { contextBridge } = require("electron")',
  '```',
  '',
  '### Heading 3',
  '',
  '#### Heading 4',
  '',
  '##### Heading 5',
  '',
  '###### Heading 6',
  '',
  '::: info 提示',
  '',
  'CALLOUT-TEXT',
  '',
  '- 提示块列表',
  '  - 提示块嵌套列表',
  '',
  ':::',
  '',
  '| Column A | Column B |',
  '| --- | --- |',
  '| Cell A | Cell B |',
  ''
].join('\n')
writeFileSync(join(note, 'README.md'), source)
writeFileSync(join(profile, 'workspace.v1.json'), JSON.stringify({ path: workspace }))
writeFileSync(
  join(profile, '.tn-desk-config.json'),
  JSON.stringify({
    version: 1,
    theme: 'dark',
    defaultNoteView: 'visual',
    prettier: false,
    autosave: { enabled: false, delayMs: 1000 }
  })
)

// Vite must emit every referenced font, and ship the license with the renderer.
const assetDir = join(deskDir, 'out/renderer/assets')
const fontFiles = readdirSync(assetDir).filter((file) => /^inter-.*\.woff2$/.test(file))
assert.equal(fontFiles.length, 14)
for (const file of fontFiles) {
  const bytes = readFileSync(join(assetDir, file))
  assert.equal(bytes.toString('ascii', 0, 4), 'wOF2')
  assert.equal(bytes.readUInt32BE(8), bytes.length)
}
assert.match(
  readFileSync(join(deskDir, 'out/renderer/licenses/Inter.txt'), 'utf8'),
  /SIL OPEN FONT LICENSE Version 1\.1/
)

const app = await _electron.launch({
  executablePath: require('electron'),
  args: ['out/main/index.js', `--user-data-dir=${profile}`],
  cwd: deskDir,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})

try {
  await app.context().setOffline(true)
  const page = await app.firstWindow()
  // Reload after forcing offline: a font cached by the launch race cannot mask a remote dependency.
  await page.reload()
  await page.getByText('typography', { exact: true }).first().click()
  await page.locator('.toc-nodes .node-label').filter({ hasText: 'typography' }).click()
  const pm = page.locator('.milkdown .ProseMirror')
  await pm.waitFor()
  const sample = 'Inter Café Ā Ω ἄ Д Ѡ ắ'
  const fontLoads = await page.evaluate(async (sample) => {
    const faces = await Promise.all([
      document.fonts.load('400 16px Inter', sample),
      document.fonts.load('600 32px Inter', sample),
      document.fonts.load('italic 400 16px Inter', sample),
      document.fonts.load('italic 700 16px Inter', sample)
    ])
    await document.fonts.ready
    return faces.map((group) => group.map((font) => ({ family: font.family, status: font.status })))
  }, sample)
  for (const group of fontLoads) {
    assert.equal(group.length, 7)
    assert.ok(group.every((font) => font.family === 'Inter' && font.status === 'loaded'))
  }
  // file: resources are not reliably exposed in Chromium's Resource Timing API.
  // Inspect the actual font faces instead; loading above proves all are usable.
  const resources = await page.evaluate(() =>
    Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules).flatMap((rule) => {
        if (!(rule instanceof CSSFontFaceRule) || rule.style.fontFamily !== 'Inter') return []
        const src = rule.style.getPropertyValue('src')
        const url = src.match(/url\(["']?([^"')]+)["']?\)/)?.[1]
        return url ? [new URL(url, sheet.href).href] : []
      })
    )
  )
  assert.equal(resources.length, 14)
  assert.ok(resources.every((url) => url.startsWith('file:')))
  console.log('✓ all 14 normal/italic Inter subsets load from the built app while offline')

  // Check actual glyph fonts, not only a CSS family that might silently fall back.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  for (const selector of [
    '.ProseMirror h1',
    '.ProseMirror h2',
    '.ProseMirror > p',
    '.ProseMirror > p strong',
    '.ProseMirror > p em'
  ]) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    assert.ok(nodeId, selector)
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    assert.ok(
      fonts.some(
        (font) =>
          /^Inter(?: Variable)?$/.test(font.familyName) && font.isCustomFont && font.glyphCount > 0
      ),
      `${selector}: must render bundled Inter glyphs: ${JSON.stringify(fonts)}`
    )
    assert.equal(
      fonts.some((font) => /Times|Cambria|Noto Serif/.test(font.familyName)),
      false
    )
  }
  await cdp.detach()
  console.log(
    '✓ headings, body, bold and italic actually render bundled Inter (not a system fallback)'
  )

  for (const mode of ['可视化编辑', '只读视图']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    await pm.waitFor()
    const styles = await pm.evaluate((element) => {
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      const read = (selector) => {
        const el = element.querySelector(selector)
        const css = getComputedStyle(el)
        return {
          font: css.fontFamily,
          size: css.fontSize,
          weight: css.fontWeight,
          line: css.lineHeight,
          synthesis: css.fontSynthesis
        }
      }
      return {
        headings: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(read),
        body: read(':scope > p'),
        toc: read('.desk-generated-toc__link'),
        code: read(':scope > p code'),
        callout: read('.custom-block-body p'),
        table: read('td p'),
        appSize: getComputedStyle(document.documentElement).fontSize
      }
    })
    const baseFont = styles.body.font
    assert.match(baseFont, /Inter, ui-sans-serif, system-ui, sans-serif/)
    assert.equal(styles.body.size, '16px')
    assert.equal(styles.body.line, '28px')
    assert.equal(styles.body.synthesis, 'style')
    assert.equal(styles.toc.font, baseFont)
    assert.equal(styles.toc.size, '16px')
    assert.equal(styles.toc.line, '24px')
    assert.deepEqual(
      styles.headings.map((h) => h.font),
      Array(6).fill(baseFont)
    )
    assert.deepEqual(
      styles.headings.map((h) => h.size),
      ['32px', '24px', '20px', '18px', '16px', '16px']
    )
    assert.ok(styles.headings.every((h) => h.weight === '600'))
    assert.match(styles.code.font, /monospace/)
    assert.equal(styles.code.size, '14px')
    assert.equal(styles.callout.line, '24px')
    assert.equal(styles.table.line, '24px')
    assert.equal(styles.appSize, '14px')
    await page.screenshot({
      path: join(shots, mode === '可视化编辑' ? 'visual.png' : 'readonly.png')
    })
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme
      }, theme)
      const markers = await pm.evaluate((element) => ({
        body: getComputedStyle(element.querySelector(':scope > p')).color,
        bullets: Array.from(element.querySelectorAll('.label.bullet svg')).map((svg) => ({
          fill: getComputedStyle(svg).fill,
          glyphs: Array.from(svg.querySelectorAll('path, circle')).map(
            (glyph) => getComputedStyle(glyph).fill
          )
        })),
        callout: Array.from(element.querySelectorAll('.custom-block-body ul > li')).map((li) => ({
          text: getComputedStyle(li).color,
          marker: getComputedStyle(li, '::before').color
        }))
      }))
      const label = `${mode}/${theme}`
      assert.equal(markers.body, theme === 'dark' ? 'rgb(223, 223, 214)' : 'rgb(60, 60, 67)')
      assert.equal(markers.bullets.length, 5, `${label}: all three list levels are covered`)
      for (const bullet of markers.bullets) {
        assert.equal(
          bullet.fill,
          markers.body,
          `${label}: bullet must match body, even beside links`
        )
        assert.ok(bullet.glyphs.length > 0)
        assert.ok(
          bullet.glyphs.every((fill) => fill === markers.body),
          label
        )
      }
      assert.equal(markers.callout.length, 2)
      for (const callout of markers.callout) {
        assert.equal(callout.marker, callout.text, `${label}: callout bullet must match its text`)
      }
      await pm.locator('.label.bullet').first().scrollIntoViewIfNeeded()
      await page.screenshot({
        path: join(shots, `bullets-${mode === '可视化编辑' ? 'visual' : 'readonly'}-${theme}.png`)
      })
    }
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
  }
  assert.equal(readFileSync(join(note, 'README.md'), 'utf8'), source)
  console.log(
    '✓ visual/readonly typography matches; code stays monospace, UI density and Markdown are unchanged'
  )
  console.log('✓ normal/nested/link-only/callout bullets match body text in dark/light themes')
} catch (error) {
  const page = await app.firstWindow()
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
  throw error
} finally {
  await app.close()
  rmSync(fixture, { recursive: true, force: true })
}
