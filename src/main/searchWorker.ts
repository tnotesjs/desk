import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import { dirname } from 'node:path'
import { parentPort } from 'node:worker_threads'
import MiniSearch from 'minisearch'

import {
  createSearchIndex,
  querySearchIndex,
  searchOptions,
  type SearchIndexDocument
} from './searchModel'

import type { SearchResultDto } from '../shared/contracts'

interface BuildRequest {
  type: 'build'
  requestId: number
  documents: SearchIndexDocument[]
  cachePath: string
}

interface SearchRequest {
  type: 'search'
  requestId: number
  query: string
  knowledgeBaseId: string | null
  limit: number
}

interface ClearRequest {
  type: 'clear'
  requestId: number
}

type WorkerRequest = BuildRequest | SearchRequest | ClearRequest

interface CachedSearchIndex {
  version: 1
  signature: string
  index: ReturnType<MiniSearch<SearchIndexDocument>['toJSON']>
}

let currentIndex = createSearchIndex([])

function documentSignature(documents: SearchIndexDocument[]): string {
  const hash = createHash('sha256')
  for (const document of [...documents].sort((left, right) => left.id.localeCompare(right.id))) {
    hash.update(document.id)
    hash.update('\0')
    hash.update(document.revision)
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function readCache(cachePath: string, signature: string): Promise<boolean> {
  try {
    const cache = JSON.parse(await fs.readFile(cachePath, 'utf8')) as CachedSearchIndex
    if (cache.version !== 1 || cache.signature !== signature) return false
    currentIndex = MiniSearch.loadJSON<SearchIndexDocument>(
      JSON.stringify(cache.index),
      searchOptions()
    )
    return true
  } catch {
    return false
  }
}

async function writeCache(cachePath: string, signature: string): Promise<void> {
  await fs.mkdir(dirname(cachePath), { recursive: true })
  const temporary = `${cachePath}.tmp`
  const cache: CachedSearchIndex = {
    version: 1,
    signature,
    index: currentIndex.toJSON()
  }
  await fs.writeFile(temporary, `${JSON.stringify(cache)}\n`, 'utf8')
  await fs.rename(temporary, cachePath)
}

async function build(request: BuildRequest): Promise<{ documentCount: number; cached: boolean }> {
  const signature = documentSignature(request.documents)
  const cached = await readCache(request.cachePath, signature)
  if (!cached) {
    currentIndex = createSearchIndex(request.documents)
    await writeCache(request.cachePath, signature)
  }
  return { documentCount: currentIndex.documentCount, cached }
}

function sendSuccess(requestId: number, value: unknown): void {
  parentPort?.postMessage({ requestId, ok: true, value })
}

function sendFailure(requestId: number, error: unknown): void {
  parentPort?.postMessage({
    requestId,
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  })
}

parentPort?.on('message', (request: WorkerRequest) => {
  void (async () => {
    try {
      if (request.type === 'build') {
        sendSuccess(request.requestId, await build(request))
        return
      }
      if (request.type === 'clear') {
        currentIndex = createSearchIndex([])
        sendSuccess(request.requestId, undefined)
        return
      }
      const results: SearchResultDto[] = querySearchIndex(
        currentIndex,
        request.query,
        request.knowledgeBaseId,
        request.limit
      )
      sendSuccess(request.requestId, results)
    } catch (error) {
      sendFailure(request.requestId, error)
    }
  })()
})
