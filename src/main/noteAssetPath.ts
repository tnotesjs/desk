import fs from 'node:fs/promises'
import path from 'node:path'

function assertSafeRequestedPath(requestedPath: string): void {
  if (
    !requestedPath ||
    /^(?:[a-z]+:|\/\/)/i.test(requestedPath) ||
    requestedPath.split(/[\\/]/).some((part) => part.toLocaleLowerCase() === '.git')
  ) {
    throw new Error('引用路径无效')
  }
}

function candidatePaths(requestedPath: string): string[] {
  const candidates = [requestedPath]
  try {
    const decoded = decodeURIComponent(requestedPath)
    if (decoded !== requestedPath) candidates.push(decoded)
  } catch {
    // A literal percent sign is a valid filename character.
  }
  return candidates
}

/** Resolves a note-local path while guarding every raw and decoded candidate. */
export async function resolvePathInsideDirectory(
  directoryPath: string,
  requestedPath: string
): Promise<string> {
  assertSafeRequestedPath(requestedPath)
  const directoryRoot = await fs.realpath(directoryPath)
  let missingCause: unknown = new Error('引用文件不存在')

  for (const candidatePath of candidatePaths(requestedPath)) {
    assertSafeRequestedPath(candidatePath)
    const candidate = path.resolve(directoryRoot, candidatePath)
    let absolutePath: string
    try {
      absolutePath = await fs.realpath(candidate)
    } catch (cause) {
      missingCause = cause
      continue
    }
    if (absolutePath !== directoryRoot && !absolutePath.startsWith(`${directoryRoot}${path.sep}`)) {
      throw new Error('引用路径超出当前笔记目录')
    }
    return absolutePath
  }

  throw missingCause
}
