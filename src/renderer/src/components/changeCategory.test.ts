// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { classifyChangePath } from './changeCategory'

describe('classifyChangePath', () => {
  it('classifies README.md inside each note directory as noteFile', () => {
    expect(classifyChangePath('notes/0070. CommonJS/README.md')).toBe('noteFile')
    expect(classifyChangePath('notes/0112.前端学习路线/README.md')).toBe('noteFile')
  })

  it('classifies knowledge-base root config files as configFile', () => {
    expect(classifyChangePath('TOC.md')).toBe('configFile')
    expect(classifyChangePath('sidebar.json')).toBe('configFile')
    expect(classifyChangePath('.tnotes.json')).toBe('configFile')
  })

  it('classifies per-note .tnotes.json as configFile', () => {
    expect(classifyChangePath('notes/0070. CommonJS/.tnotes.json')).toBe('configFile')
  })

  it('classifies everything else as otherFile', () => {
    expect(classifyChangePath('package.json')).toBe('otherFile')
    expect(classifyChangePath('pnpm-lock.yaml')).toBe('otherFile')
    expect(classifyChangePath('pnpm-workspace.yaml')).toBe('otherFile')
    // assets inside a note directory are not the note README.
    expect(classifyChangePath('notes/0070. CommonJS/assets/1.md')).toBe('otherFile')
    // a note body named after the note (not README.md) is not a "note file" per the current rule.
    expect(classifyChangePath('notes/0112.前端学习路线/前端学习路线.md')).toBe('otherFile')
    // the knowledge-base root README.md is not under a note directory.
    expect(classifyChangePath('README.md')).toBe('otherFile')
  })

  it('normalizes Windows separators before classifying', () => {
    expect(classifyChangePath('notes\\0070. CommonJS\\README.md')).toBe('noteFile')
    expect(classifyChangePath('notes\\0070. CommonJS\\.tnotes.json')).toBe('configFile')
  })
})
