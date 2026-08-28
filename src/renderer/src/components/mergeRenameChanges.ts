import type { GitFileChangeDto } from '../../../shared/contracts'

/** Extract the immutable 4-digit note index from a `notes/<index>.<title>/...` path. */
function noteIndexFromPath(path: string): string | null {
  const match = path.replace(/\\/g, '/').match(/^notes\/(\d{4})\./)
  return match ? match[1] : null
}

/** Tail of the path after the note directory (e.g. `README.md`, `.tnotes.json`). */
function noteRelPath(path: string): string | null {
  const match = path.replace(/\\/g, '/').match(/^notes\/[^/]+\/(.+)$/)
  return match ? match[1] : null
}

/**
 * Display-level merge for unstaged note renames.
 *
 * Git reports an unstaged rename as a tracked deletion (old dir) plus an
 * untracked new directory. This ONLY reshapes the rendered list: the change
 * COUNT must stay the true git count, so callers keep counting the raw list.
 *
 * TNotes note indexes (first 4 digits) are unique and immutable, so a deleted
 * entry and an untracked entry sharing the same index are exactly one rename.
 */
export function mergeRenameChanges(
  changes: readonly GitFileChangeDto[]
): GitFileChangeDto[] {
  const pairs = new Map<string, { deleted?: GitFileChangeDto; untracked?: GitFileChangeDto }>()
  for (const change of changes) {
    const index = noteIndexFromPath(change.path)
    const rel = noteRelPath(change.path)
    if (index === null || rel === null) continue
    const key = `${index}/${rel}`
    const bucket = pairs.get(key) ?? {}
    if (change.status === 'deleted') bucket.deleted = change
    else if (change.status === 'untracked') bucket.untracked = change
    pairs.set(key, bucket)
  }

  const consumed = new Set<GitFileChangeDto>()
  const result: GitFileChangeDto[] = []
  for (const change of changes) {
    if (consumed.has(change)) continue
    const index = noteIndexFromPath(change.path)
    const rel = noteRelPath(change.path)
    const bucket = index !== null && rel !== null ? pairs.get(`${index}/${rel}`) : undefined
    if (bucket?.deleted && bucket.untracked) {
      consumed.add(bucket.deleted)
      consumed.add(bucket.untracked)
      result.push({
        ...bucket.untracked,
        path: bucket.untracked.path,
        previousPath: bucket.deleted.path,
        status: 'renamed',
        staged: false,
        worktree: true
      })
      continue
    }
    result.push(change)
  }
  return result
}
