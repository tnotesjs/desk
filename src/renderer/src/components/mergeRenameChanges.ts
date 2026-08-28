import type { GitFileChangeDto } from '../../../shared/contracts'

/** Extract the immutable 4-digit note index from a note path (incl. .trash). */
function noteIndexFromPath(path: string): string | null {
  const match = path.replace(/\\/g, '/').match(/(?:^|\/)notes\/(?:\.trash\/)?(\d{4})\./)
  return match ? match[1] : null
}

/** Basename used for pairing (README.md / .tnotes.json). */
function noteBasename(path: string): string | null {
  const match = path.replace(/\\/g, '/').match(/([^/]+)$/)
  return match ? match[1] : null
}

/**
 * Display-level merge for unstaged note renames / soft-deletes.
 *
 * Git reports an unstaged rename as a tracked deletion (old dir) plus an
 * untracked new directory; a 0004 soft-delete moves the dir into
 * notes/.trash/. This ONLY reshapes the rendered list: the change COUNT must
 * stay the true git count, so callers keep counting the raw list.
 *
 * TNotes note indexes (first 4 digits) are unique and immutable, so a deleted
 * entry and an untracked entry sharing the same index + basename are exactly
 * one rename (or one trashed move).
 */
export function mergeRenameChanges(changes: readonly GitFileChangeDto[]): GitFileChangeDto[] {
  const pairs = new Map<string, { deleted?: GitFileChangeDto; untracked?: GitFileChangeDto }>()
  for (const change of changes) {
    const index = noteIndexFromPath(change.path)
    const basename = noteBasename(change.path)
    if (index === null || basename === null) continue
    const key = `${index}/${basename}`
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
    const basename = noteBasename(change.path)
    const bucket =
      index !== null && basename !== null ? pairs.get(`${index}/${basename}`) : undefined
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
