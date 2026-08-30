// Runtime diagnostic for the actual playground note reported by the user.
// It never edits or saves the note; each top/middle/bottom click records every
// cursor implementation and ProseMirror selection involved in the interaction.
import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const deskDir = '/Users/huyouda/tnotesjs/desk'
const profile = mkdtempSync(join(tmpdir(), 'desk-actual-break-caret-'))
const shots = join(deskDir, 'scripts', 'shots', 'actual-break-carets')

mkdirSync(shots, { recursive: true })
writeFileSync(
  join(profile, 'workspace.v1.json'),
  `${JSON.stringify({ path: join(deskDir, 'playground') }, null, 2)}\n`
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

// Playwright's browser-evaluated values are intentionally runtime-shaped.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function capture(page, label, log = true) {
  const state = await page.evaluate(() => {
    const pm = document.querySelector('.milkdown .ProseMirror')
    const selection = document.getSelection()
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const describeNode = (node) => {
      if (!node) return null
      if (node.nodeType === Node.TEXT_NODE) {
        return {
          type: '#text',
          text: node.textContent?.slice(0, 40) ?? '',
          parent: node.parentElement?.className ?? ''
        }
      }
      const element = node
      return {
        type: element.tagName,
        class: element.className,
        kind: element.dataset?.kind ?? null
      }
    }
    const breaks = [...document.querySelectorAll('[data-kind="raw-break"]')]
    return {
      activeElement: describeNode(document.activeElement),
      pm: pm
        ? {
            contenteditable: pm.getAttribute('contenteditable'),
            focusedClass: pm.classList.contains('ProseMirror-focused'),
            virtualCursorEnabled: pm.classList.contains('virtual-cursor-enabled'),
            caretColor: getComputedStyle(pm).caretColor
          }
        : null,
      selection: selection
        ? {
            rangeCount: selection.rangeCount,
            isCollapsed: selection.isCollapsed,
            anchorOffset: selection.anchorOffset,
            focusOffset: selection.focusOffset,
            anchor: describeNode(selection.anchorNode),
            focus: describeNode(selection.focusNode)
          }
        : null,
      breaks: breaks.map((element, index) => {
        const rect = element.getBoundingClientRect()
        const marker = getComputedStyle(element, '::before')
        return {
          index,
          class: element.className,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          marker: {
            content: marker.content,
            display: marker.display,
            width: marker.width,
            height: marker.height,
            opacity: marker.opacity,
            background: marker.backgroundColor
          }
        }
      }),
      cursorElements: [
        ...document.querySelectorAll(
          '.desk-raw-boundary-cursor, .prosemirror-virtual-cursor, .ProseMirror-gapcursor, .crepe-drop-cursor'
        )
      ].map((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const after = getComputedStyle(element, '::after')
        return {
          class: element.className,
          side: element.dataset.side ?? null,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          after: {
            content: after.content,
            width: after.width,
            height: after.height,
            opacity: after.opacity,
            background: after.backgroundColor
          }
        }
      })
    }
  })
  const selectedMarkers = state.breaks.filter(
    (line) => line.marker.content !== 'none' && line.marker.background !== 'rgba(0, 0, 0, 0)'
  ).length
  const explicitMarkers = state.cursorElements.filter(
    (cursor) =>
      cursor.display !== 'none' &&
      cursor.visibility !== 'hidden' &&
      ((cursor.rect.height > 0 && cursor.rect.width > 0) ||
        (cursor.after.content !== 'none' && cursor.after.background !== 'rgba(0, 0, 0, 0)'))
  ).length
  const nativeCaretImplementation =
    state.pm?.caretColor !== 'transparent' && state.pm?.caretColor !== 'rgba(0, 0, 0, 0)' ? 1 : 0
  state.nativeCaretImplementation = nativeCaretImplementation
  state.paintedCaretImplementations = selectedMarkers + explicitMarkers + nativeCaretImplementation
  if (log) {
    console.log(`\n${label}`)
    console.log(JSON.stringify(state, null, 2))
  }
  return state
}

try {
  const page = await app.firstWindow({ timeout: 30000 })
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize({ width: 1360, height: 920 })
  await page.getByText('docs', { exact: true }).first().waitFor({ timeout: 30000 })
  await page.getByText('docs', { exact: true }).first().click()
  await page.getByText('0041', { exact: true }).first().waitFor({ timeout: 30000 })
  await page.getByText('0041', { exact: true }).first().click()

  const breaks = page.locator('.milkdown .ProseMirror [data-kind="raw-break"]')
  await breaks.first().waitFor({ timeout: 30000 })
  const breakCount = await breaks.count()
  assert.ok(breakCount >= 1, 'the reported note should expose at least one visual <br /> line')
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await page.locator('h2').filter({ hasText: '2. 评价' }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const initialState = await capture(page, 'initial')
  assert.equal(initialState.pm?.virtualCursorEnabled, true)
  assert.equal(initialState.pm?.caretColor, 'rgba(0, 0, 0, 0)')
  assert.equal(initialState.nativeCaretImplementation, 0)
  assert.equal(initialState.paintedCaretImplementations, 1)

  const clickPoints = [
    { point: 'middle', y: (height) => height / 2 },
    { point: 'top', y: () => 1 },
    { point: 'middle', y: (height) => height / 2 },
    { point: 'bottom', y: (height) => height - 1 }
  ]
  const clickCases = Array.from({ length: breakCount }, (_, line) => ({
    line,
    ...clickPoints[line % clickPoints.length]
  }))

  for (const clickCase of clickCases) {
    const line = breaks.nth(clickCase.line)
    const box = await line.boundingBox()
    assert.ok(box)
    await line.click({ position: { x: 20, y: clickCase.y(box.height) } })
    await page.waitForTimeout(40)
    const label = `line-${clickCase.line + 1}-${clickCase.point}`
    await capture(page, label)
    await page.screenshot({ path: join(shots, `${label}.png`) })
  }

  // Match the latest field report in the light theme: select the first blank
  // line, then the last one currently present in the real note. The note is a
  // user-owned fixture and may be edited between runs, so its line count is
  // intentionally discovered instead of hard-coded.
  const firstBox = await breaks.first().boundingBox()
  const lastBox = await breaks.last().boundingBox()
  assert.ok(firstBox)
  assert.ok(lastBox)
  await breaks.first().click({ position: { x: 2, y: firstBox.height / 2 } })
  await breaks.last().click({ position: { x: 2, y: lastBox.height / 2 } })
  await page.waitForTimeout(80)
  const lightFirstToLast = await capture(page, 'light-first-to-last-single-caret')
  assert.equal(lightFirstToLast.pm?.caretColor, 'rgba(0, 0, 0, 0)')
  assert.equal(lightFirstToLast.nativeCaretImplementation, 0)
  assert.equal(lightFirstToLast.paintedCaretImplementations, 1)
  await page.screenshot({ path: join(shots, 'light-first-to-last-single-caret.png') })

  // The reported path switches from source back to visual before clicking the
  // rendered <br /> positions. Repeat that exact view lifecycle and probe every
  // vertical pixel band, including the overlapping 10px boundary controls.
  await page.getByRole('button', { name: '源码视图', exact: true }).click()
  await page.locator('.markdown-source-editor .cm-content').first().waitFor()
  assert.equal(
    (await page.locator('.markdown-source-editor .cm-content').first().textContent()).match(
      /<br \/>/g
    )?.length ?? 0,
    breakCount
  )
  await page.getByRole('button', { name: '可视化编辑', exact: true }).click()
  await breaks.first().waitFor()
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })

  const anomalies = []
  for (let lineIndex = 0; lineIndex < breakCount; lineIndex += 1) {
    const line = breaks.nth(lineIndex)
    const box = await line.boundingBox()
    assert.ok(box)
    for (const y of [0.5, 2, 5, 9, 11, box.height / 2, 16, 20, 23, box.height - 0.5]) {
      await line.click({ position: { x: 2, y } })
      for (const delay of [0, 40, 160, 520]) {
        if (delay) await page.waitForTimeout(delay)
        const state = await capture(
          page,
          `sweep-line-${lineIndex + 1}-y-${y}-delay-${delay}`,
          false
        )
        if (state.paintedCaretImplementations > 1) {
          anomalies.push({ lineIndex, y, delay, state })
          await page.screenshot({
            path: join(shots, `anomaly-line-${lineIndex + 1}-y-${y}-delay-${delay}.png`)
          })
        }
      }
    }
  }
  console.log(`\nANOMALIES: ${anomalies.length}`)
  if (anomalies.length) console.log(JSON.stringify(anomalies, null, 2))
  assert.equal(anomalies.length, 0)

  // Recreate the DOM residue visible in the user's screenshot: multiple raw
  // NodeViews carry the imperative selected class at once. Only the one
  // state-derived selection Decoration is allowed to paint a caret.
  if (breakCount >= 3) {
    const middleIndex = Math.floor(breakCount / 2)
    const middle = breaks.nth(middleIndex)
    const middleBox = await middle.boundingBox()
    assert.ok(middleBox)
    await middle.click({ position: { x: 2, y: middleBox.height / 2 } })
    await breaks.evaluateAll((elements) => {
      elements[0].classList.add('ProseMirror-selectednode')
      elements[elements.length - 1].classList.add('ProseMirror-selectednode')
    })
    const residueState = await capture(page, 'simulated-stale-nodeview-selection-classes')
    assert.equal(
      residueState.breaks.filter((line) => line.class.includes('ProseMirror-selectednode')).length,
      3
    )
    assert.equal(residueState.paintedCaretImplementations, 1)
    await page.screenshot({ path: join(shots, 'stale-nodeview-classes-single-caret.png') })
  } else {
    console.log('\nStale multi-node NodeView residue probe skipped: fewer than three real breaks')
  }

  console.log(`\nScreenshots: ${shots}`)
} finally {
  await app.close()
  rmSync(profile, { recursive: true, force: true })
}
