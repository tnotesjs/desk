import { describe, expect, it } from 'vitest'
import { mergeRenameChanges } from './mergeRenameChanges'
import type { GitFileChangeDto } from '../../../shared/contracts'

function change(
  partial: Partial<GitFileChangeDto> & { path: string; status: GitFileChangeDto['status'] }
): GitFileChangeDto {
  return { staged: false, worktree: true, ...partial }
}

describe('mergeRenameChanges', () => {
  it('合并同索引的 deleted+untracked（README.md）为一条 renamed', () => {
    const raw = [
      change({ path: 'notes/0016. TNotes 更新日志/README.md', status: 'deleted' }),
      change({ path: 'notes/0016. TNotes 更新日志111/README.md', status: 'untracked' })
    ]
    const merged = mergeRenameChanges(raw)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      path: 'notes/0016. TNotes 更新日志111/README.md',
      previousPath: 'notes/0016. TNotes 更新日志/README.md',
      status: 'renamed'
    })
  })

  it('README 与 .tnotes.json 各自配对，保持文件级粒度', () => {
    const raw = [
      change({ path: 'notes/0016. TNotes 更新日志/README.md', status: 'deleted' }),
      change({ path: 'notes/0016. TNotes 更新日志/.tnotes.json', status: 'deleted' }),
      change({ path: 'notes/0016. TNotes 更新日志111/README.md', status: 'untracked' }),
      change({ path: 'notes/0016. TNotes 更新日志111/.tnotes.json', status: 'untracked' })
    ]
    const merged = mergeRenameChanges(raw)
    expect(merged).toHaveLength(2)
    expect(merged.every((item) => item.status === 'renamed')).toBe(true)
  })

  it('不同索引的 deleted/untracked 不合并', () => {
    const raw = [
      change({ path: 'notes/0016. 旧/README.md', status: 'deleted' }),
      change({ path: 'notes/0024. 新/README.md', status: 'untracked' })
    ]
    expect(mergeRenameChanges(raw)).toHaveLength(2)
  })

  it('仅单独的 deleted 或 untracked 保持不变', () => {
    const deleted = change({ path: 'notes/0016. X/README.md', status: 'deleted' })
    const untracked = change({ path: 'notes/0016. X/README.md', status: 'untracked' })
    expect(mergeRenameChanges([deleted])).toHaveLength(1)
    expect(mergeRenameChanges([untracked])).toHaveLength(1)
  })

  it('非 notes 路径（TOC.md/sidebar.json）不受影响', () => {
    const toc = change({ path: 'TOC.md', status: 'modified' })
    const sidebar = change({ path: 'sidebar.json', status: 'modified' })
    expect(mergeRenameChanges([toc, sidebar])).toHaveLength(2)
  })

  it('合并后的重命名条目前部保留 untracked 富化字段（noteUuid）', () => {
    const raw = [
      change({ path: 'notes/0016. 旧/README.md', status: 'deleted' }),
      change({
        path: 'notes/0016. 新/README.md',
        status: 'untracked',
        noteUuid: 'uuid-1',
        noteIndex: '0016',
        noteTitle: '新'
      })
    ]
    const merged = mergeRenameChanges(raw)
    expect(merged[0]).toMatchObject({ noteUuid: 'uuid-1', noteIndex: '0016', noteTitle: '新' })
  })

  it('软删（旧目录 D + .trash 下同索引 U）合并为一条 renamed', () => {
    const raw = [
      change({ path: 'notes/0005. Broken/README.md', status: 'deleted' }),
      change({ path: 'notes/.trash/0005. Broken/README.md', status: 'untracked' })
    ]
    const merged = mergeRenameChanges(raw)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      path: 'notes/.trash/0005. Broken/README.md',
      previousPath: 'notes/0005. Broken/README.md',
      status: 'renamed'
    })
  })
})
