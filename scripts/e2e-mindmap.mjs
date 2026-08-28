// E2E probe: launch desk (built output) via Playwright Electron, drive UI, screenshot the mindmap block.
// Usage: node scripts/e2e-mindmap.mjs [--probe]   (--probe = just screenshot main window & dump text)
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const DESK_DIR = '/Users/huyouda/tnotesjs/desk'
const PROFILE = '/tmp/desk-e2e-profile'
const SHOTS = join(DESK_DIR, 'scripts/shots')
mkdirSync(SHOTS, { recursive: true })

const probe = process.argv.includes('--probe')
const docsMode = process.argv.includes('--docs')
const mindmapMode = process.argv.includes('--mindmap')
const codeblocksMode = process.argv.includes('--codeblocks')

// Pre-seed an isolated user-data dir so the single-instance lock does not collide
// with a running desk dev instance. Workspace points at the playground repo.
mkdirSync(PROFILE, { recursive: true })
writeFileSync(
  join(PROFILE, 'workspace.v1.json'),
  JSON.stringify({ path: join(DESK_DIR, 'playground') }, null, 2) + '\n'
)
// Force the visual editor view deterministically (fresh profile has no settings).
writeFileSync(
  join(PROFILE, 'settings.json'),
  JSON.stringify({ version: 1, defaultNoteView: 'visual', theme: 'system' }, null, 2) + '\n'
)

const app = await _electron.launch({
  executablePath: electronPath,
  args: ['out/main/index.js', `--user-data-dir=${PROFILE}`],
  cwd: DESK_DIR,
  timeout: 60000,
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
})

try {
  const win = await app.firstWindow({ timeout: 30000 })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  const info = await win.evaluate(() => ({
    title: document.title,
    url: location.href,
    hasSidebar: !!document.querySelector('.sidebar, [class*="sidebar"], nav'),
    text: document.body?.innerText?.slice(0, 500) ?? ''
  }))
  console.log('PAGE INFO:')
  console.log(JSON.stringify(info, null, 2))

  await win.screenshot({ path: join(SHOTS, '01-main.png') })
  console.log('screenshot -> scripts/shots/01-main.png')

  if (docsMode) {
    // Click the "docs" knowledge base and dump the notes list structure
    const kb = win.getByText('docs', { exact: true }).first()
    await kb.click()
    await win.waitForTimeout(1500)
    const notes = await win.evaluate(() => {
      const txt = document.body?.innerText ?? ''
      const cut = txt.indexOf('TNotes.docs') >= 0 ? txt : txt
      return cut.slice(0, 900)
    })
    console.log('NOTES LIST TEXT:')
    console.log(notes)
    await win.screenshot({ path: join(SHOTS, '02-docs.png') })
    console.log('screenshot -> scripts/shots/02-docs.png')
  }

  if (mindmapMode) {
    // 1) open the docs knowledge base, then note 0041
    await win.getByText('docs', { exact: true }).first().click()
    await win.waitForTimeout(1200)
    await win.getByText('0041', { exact: true }).first().click()
    // 2) wait for the mindmap diagram node to appear (activate() runs + 120/500/1200ms zoomToFit timers)
    await win.locator('.desk-diagram__mindmap canvas').first().waitFor({ timeout: 20000 })
    await win.waitForTimeout(2500)

    const analysis = await win.evaluate(() => {
      const host = document.querySelector('.desk-diagram__mindmap')
      const canvas = host?.querySelector('canvas')
      if (!host || !canvas) return { error: 'host/canvas missing', html: host?.outerHTML?.slice(0, 400) }
      const hostRect = host.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const style = getComputedStyle(canvas)
      const ctx = canvas.getContext('2d')
      const bw = canvas.width
      const bh = canvas.height
      const data = ctx.getImageData(0, 0, bw, bh).data
      const bg = [data[0], data[1], data[2]]
      let minX = bw, minY = bh, maxX = -1, maxY = -1, count = 0
      for (let y = 0; y < bh; y++) {
        let row = y * bw * 4
        for (let x = 0; x < bw; x++) {
          const i = row + x * 4
          if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 40) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
            count++
          }
        }
      }
      const drawn = count > 0
      // visible-region relationship: does the host clip the oversized canvas?
      const hostOverflow = getComputedStyle(host).overflow
      const hostClient = { cw: host.clientWidth, ch: host.clientHeight, sw: host.scrollWidth, sh: host.scrollHeight }
      let parent = canvas.parentElement
      let parentInfo = []
      while (parent && parent !== host) {
        const pr = parent.getBoundingClientRect()
        parentInfo.push({
          class: parent.className,
          size: `${pr.width.toFixed(0)}x${pr.height.toFixed(0)}`,
          overflow: getComputedStyle(parent).overflow,
          transform: getComputedStyle(parent).transform
        })
        parent = parent.parentElement
      }
      const canvasOffset = { left: canvas.offsetLeft, top: canvas.offsetTop, parent: canvas.offsetParent?.className }
      return {
        host: { w: hostRect.width, h: hostRect.height, overflow: hostOverflow, ...hostClient, class: host.className },
        canvas: {
          bitmap: `${bw}x${bh}`,
          cssSize: `${canvasRect.width.toFixed(1)}x${canvasRect.height.toFixed(1)}`,
          cssTransform: style.transform,
          position: style.position,
          class: canvas.className,
          offset: canvasOffset
        },
        wrappers: parentInfo,
        pixels: drawn
          ? {
              bbox: `(${minX},${minY})-(${maxX},${maxY})`,
              bboxSize: `${maxX - minX}x${maxY - minY}`,
              center: `(${((minX + maxX) / 2).toFixed(0)},${((minY + maxY) / 2).toFixed(0)})`,
              canvasCenter: `(${(bw / 2).toFixed(0)},${(bh / 2).toFixed(0)})`,
              offsetFromCanvasCenter: `(${((minX + maxX) / 2 - bw / 2).toFixed(0)},${((minY + maxY) / 2 - bh / 2).toFixed(0)})`,
              contentCoverage: `${(((maxX - minX) / bw) * 100).toFixed(1)}% x ${(((maxY - minY) / bh) * 100).toFixed(1)}%`,
              pixelCount: count
            }
          : { error: 'no non-background pixels drawn' }
      }
    })
    console.log('MINDMAP ANALYSIS:')
    console.log(JSON.stringify(analysis, null, 2))

    await win.locator('.desk-diagram__mindmap').first().screenshot({ path: join(SHOTS, '03-mindmap.png') })
    console.log('screenshot -> scripts/shots/03-mindmap.png')
  }

  if (codeblocksMode) {
    // Reproduce desk-032: several code blocks highlight their first line simultaneously while unfocused.
    await win.getByText('docs', { exact: true }).first().click()
    await win.waitForTimeout(1500)
    await win.getByText('0041', { exact: true }).first().click()
    await win.waitForTimeout(1500)
    await win.locator('.milkdown').first().waitFor({ timeout: 30000 })
    await win.waitForTimeout(1500)
    // CodeMirror code-block editors lazy-mount: scroll to the bottom to force them in.
    for (let i = 0; i < 30; i++) {
      if ((await win.locator('.cm-editor').count()) > 0) break
      await win.evaluate(() => {
        let el = document.querySelector('.milkdown')
        while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement
        if (el) el.scrollTop = el.scrollHeight
      })
      await win.waitForTimeout(200)
    }
    await win.locator('.cm-editor').first().waitFor({ timeout: 30000 })
    await win.waitForTimeout(2000)

    const stats = await win.evaluate(() => {
      const editors = [...document.querySelectorAll('.cm-editor')]
      const withActiveLine = editors.filter((e) => e.querySelector('.cm-activeLine'))
      const visible = editors.filter((e) => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight
      })
      return {
        codeEditorTotal: editors.length,
        codeEditorsWithActiveLine: withActiveLine.length,
        totalActiveLines: document.querySelectorAll('.cm-activeLine').length,
        visibleCodeEditors: visible.length,
        // does the whole editor (milkdown root) have focus?
        milkdownHasFocus: document.querySelector('.milkdown') === document.activeElement ||
          !!document.querySelector('.milkdown:focus'),
        activeLineSamples: [...document.querySelectorAll('.cm-activeLine')]
          .map((l) => l.textContent.slice(0, 24)).slice(0, 8)
      }
    })
    console.log('CODEBLOCK STATS (desk-032):')
    console.log(JSON.stringify(stats, null, 2))

    // Precisely check whether the .cm-activeLine highlight is VISUALLY rendered
    const colorCheck = await win.evaluate(() => {
      const editors = [...document.querySelectorAll('.cm-editor')]
      const active = editors.map((e) => {
        const activeLine = e.querySelector('.cm-line.cm-activeLine')
        const otherLine = e.querySelector('.cm-line:not(.cm-activeLine)')
        const bg = activeLine ? getComputedStyle(activeLine).backgroundColor : null
        const otherBg = otherLine ? getComputedStyle(otherLine).backgroundColor : null
        const theme = getComputedStyle(e).colorScheme
        return {
          code: activeLine?.textContent?.slice(0, 24) ?? '',
          activeLineBg: bg,
          normalLineBg: otherBg,
          highlightIsRendered: bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== otherBg
        }
      })
      return { active, highlightRenderedCount: active.filter((a) => a.highlightIsRendered).length }
    })
    console.log('HIGHLIGHT COLOR CHECK:')
    console.log(JSON.stringify(colorCheck, null, 2))

    // Confirm :focus-within works: click into a code block, its activeLine bg should become non-transparent.
    await win.locator('.cm-editor').first().click()
    await win.waitForTimeout(500)
    const focusedCheck = await win.evaluate(() => {
      const active = document.querySelector('.cm-editor .cm-line.cm-activeLine')
      const editor = document.querySelector('.cm-editor')
      return {
        clickedIsFocusWithin: editor ? editor.matches(':focus-within') : null,
        activeLineBgAfterFocus: active ? getComputedStyle(active).backgroundColor : null
      }
    })
    console.log('FOCUSED CHECK (clicked into a code block):')
    console.log(JSON.stringify(focusedCheck, null, 2))

    // High-res crop of the first code editor to make the first-line highlight unmistakable
    await win.locator('.cm-editor').first().scrollIntoViewIfNeeded()
    await win.waitForTimeout(300)
    await win.locator('.cm-editor').first().screenshot({ path: join(SHOTS, '05-code-editor-highres.png') })
    console.log('screenshot -> scripts/shots/05-code-editor-highres.png')

    // Scroll a batch of code blocks into view and screenshot the working window
    await win.locator('.cm-editor').nth(2).scrollIntoViewIfNeeded()
    await win.waitForTimeout(600)
    await win.screenshot({ path: join(SHOTS, '04-codeblocks.png') })
    console.log('screenshot -> scripts/shots/04-codeblocks.png')
  }
} finally {
  await app.close()
}
