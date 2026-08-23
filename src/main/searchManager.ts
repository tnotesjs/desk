import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { app } from 'electron'

import { deskLog } from './log'

import type { SearchIndexDocument } from './searchModel'
import type { SearchRequest, SearchResultDto } from '../shared/contracts'

interface WorkerResponse<T = unknown> {
  requestId: number
  ok: boolean
  value?: T
  error?: string
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
}

interface SearchManagerEvents {
  changed: [{ status: 'idle' | 'building' | 'ready' | 'error'; documentCount: number }]
}

export class SearchManager {
  private readonly events = new EventEmitter<SearchManagerEvents>()
  private readonly worker = new Worker(join(__dirname, 'searchWorker.js'))
  private readonly pending = new Map<number, PendingRequest>()
  private requestId = 0
  private workspacePath: string | null = null
  private ready: Promise<void> = Promise.resolve()
  private resolveReady: (() => void) | null = null
  private status: 'idle' | 'building' | 'ready' | 'error' = 'idle'
  private documentCount = 0

  constructor() {
    this.worker.on('message', (response: WorkerResponse) => {
      const pending = this.pending.get(response.requestId)
      if (!pending) return
      this.pending.delete(response.requestId)
      if (response.ok) pending.resolve(response.value)
      else pending.reject(new Error(response.error || '搜索工作线程返回未知错误'))
    })
    this.worker.on('error', (error) => {
      deskLog('search', 'worker error', error.message)
      this.status = 'error'
      this.emitChanged()
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
      this.resolveReady?.()
      this.resolveReady = null
    })
  }

  onChanged(
    listener: (state: {
      status: 'idle' | 'building' | 'ready' | 'error'
      documentCount: number
    }) => void
  ): () => void {
    this.events.on('changed', listener)
    return () => this.events.off('changed', listener)
  }

  setWorkspace(workspacePath: string | null): void {
    if (workspacePath === this.workspacePath) return
    this.workspacePath = workspacePath
    this.documentCount = 0
    if (!workspacePath) {
      this.status = 'idle'
      this.ready = Promise.resolve()
      void this.request('clear', {})
      this.emitChanged()
      return
    }
    this.status = 'building'
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve
    })
    this.emitChanged()
  }

  async rebuild(workspacePath: string, documents: SearchIndexDocument[]): Promise<void> {
    if (workspacePath !== this.workspacePath) return
    this.status = 'building'
    this.emitChanged()
    try {
      const result = await this.request<{ documentCount: number; cached: boolean }>('build', {
        documents,
        cachePath: this.cachePath(workspacePath)
      })
      if (workspacePath !== this.workspacePath) return
      this.documentCount = result.documentCount
      this.status = 'ready'
      deskLog('search', result.cached ? 'cache restored' : 'index rebuilt', {
        workspacePath,
        documents: result.documentCount
      })
    } catch (error) {
      this.status = 'error'
      deskLog('search', 'index failed', error instanceof Error ? error.message : String(error))
    } finally {
      this.resolveReady?.()
      this.resolveReady = null
      this.emitChanged()
    }
  }

  async search(request: SearchRequest): Promise<SearchResultDto[]> {
    if (!request.query.trim() || !this.workspacePath) return []
    await this.ready
    if (this.status === 'error') throw new Error('搜索索引不可用，请重新扫描工作区')
    return this.request<SearchResultDto[]>('search', {
      query: request.query,
      knowledgeBaseId: request.knowledgeBaseId,
      limit: request.limit ?? 40
    })
  }

  async dispose(): Promise<void> {
    for (const pending of this.pending.values()) pending.reject(new Error('搜索服务已关闭'))
    this.pending.clear()
    await this.worker.terminate()
    this.events.removeAllListeners()
  }

  private request<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    const requestId = (this.requestId += 1)
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject
      })
      this.worker.postMessage({ type, requestId, ...payload })
    })
  }

  private cachePath(workspacePath: string): string {
    const key = createHash('sha256').update(workspacePath).digest('hex').slice(0, 20)
    return join(app.getPath('userData'), 'search-index-v1', `${key}.json`)
  }

  private emitChanged(): void {
    this.events.emit('changed', { status: this.status, documentCount: this.documentCount })
  }
}

export const searchManager = new SearchManager()
