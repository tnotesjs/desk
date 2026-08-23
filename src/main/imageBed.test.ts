import { describe, expect, it } from 'vitest'

import {
  formatImageFileName,
  normalizeRemotePath,
  parseGitHubRepository,
  renderCdnUrl
} from './imageBed'

describe('GitHub image bed helpers', () => {
  it('accepts GitHub URLs and owner/repository notation', () => {
    expect(parseGitHubRepository('tnotesjs/images')).toEqual({
      owner: 'tnotesjs',
      repository: 'images'
    })
    expect(parseGitHubRepository('https://github.com/tnotesjs/images.git/')).toEqual({
      owner: 'tnotesjs',
      repository: 'images'
    })
    expect(() => parseGitHubRepository('https://example.com/a/b')).toThrow('仅支持 GitHub')
  })

  it('formats safe names and adds a duplicate suffix', () => {
    const date = new Date(2026, 7, 23, 9, 8, 7)
    expect(formatImageFileName('${YY}-${MM}-${DD}-${HH}-${mm}-${ss}', 'screen.PNG', date)).toBe(
      '26-08-23-09-08-07.png'
    )
    expect(formatImageFileName('desk/image', 'screen.png', date, 1)).toBe('desk-image-2.png')
  })

  it('normalizes the remote path and expands a CDN template', () => {
    const repository = { owner: 'tnotesjs', repository: 'images' }
    expect(normalizeRemotePath('/docs/../shots/', 'a.png')).toBe('docs/shots/a.png')
    expect(
      renderCdnUrl(
        'https://cdn.jsdelivr.net/gh/${username}/${repository}@${branch}/${filepath}',
        repository,
        'main',
        'shots/a.png'
      )
    ).toBe('https://cdn.jsdelivr.net/gh/tnotesjs/images@main/shots/a.png')
  })
})
