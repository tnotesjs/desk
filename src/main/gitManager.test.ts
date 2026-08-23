import { describe, expect, it } from 'vitest'

import { parseGitStatus } from './gitManager'

describe('Git porcelain parser', () => {
  it('parses tracked, untracked, renamed and conflicted paths', () => {
    const result = parseGitStatus(
      ' M notes/0001/README.md\0?? notes/0001/assets/new.png\0R  notes/0002/README.md\0notes/old/README.md\0UU TOC.md\0'
    )
    expect(result).toMatchObject([
      { path: 'notes/0001/README.md', status: 'modified', worktree: true },
      { path: 'notes/0001/assets/new.png', status: 'untracked' },
      {
        path: 'notes/0002/README.md',
        previousPath: 'notes/old/README.md',
        status: 'renamed',
        staged: true
      },
      { path: 'TOC.md', status: 'conflicted' }
    ])
  })
})
