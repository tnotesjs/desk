import MiniSearch from 'minisearch'

import type { SearchResultDto } from '../shared/contracts'

export interface SearchIndexDocument {
  id: string
  knowledgeBaseId: string
  knowledgeBaseName: string
  noteUuid: string
  noteIndex: string
  title: string
  content: string
  revision: string
}

export function tokenizeSearchText(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  const segmenter = new Intl.Segmenter(['zh-CN', 'en'], { granularity: 'word' })
  return [...segmenter.segment(normalized)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment.trim())
    .filter(Boolean)
}

export function searchOptions(): ConstructorParameters<typeof MiniSearch<SearchIndexDocument>>[0] {
  return {
    fields: ['title', 'noteIndex', 'content'],
    storeFields: [
      'knowledgeBaseId',
      'knowledgeBaseName',
      'noteUuid',
      'noteIndex',
      'title',
      'content'
    ],
    tokenize: tokenizeSearchText,
    processTerm: (term) => term.normalize('NFKC').toLocaleLowerCase()
  }
}

export function createSearchIndex(
  documents: SearchIndexDocument[]
): MiniSearch<SearchIndexDocument> {
  const index = new MiniSearch<SearchIndexDocument>(searchOptions())
  index.addAll(documents)
  return index
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[\s>#+*\-|]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function searchSnippet(content: string, query: string, maximumLength = 180): string {
  const text = plainText(content)
  if (!text) return ''
  const terms = tokenizeSearchText(query)
  const lower = text.toLocaleLowerCase()
  const positions = terms
    .map((term) => lower.indexOf(term.toLocaleLowerCase()))
    .filter((position) => position >= 0)
  const matchPosition = positions.length ? Math.min(...positions) : 0
  const start = Math.max(0, matchPosition - Math.floor(maximumLength * 0.28))
  const excerpt = text.slice(start, start + maximumLength).trim()
  return `${start > 0 ? '…' : ''}${excerpt}${start + maximumLength < text.length ? '…' : ''}`
}

export function querySearchIndex(
  index: MiniSearch<SearchIndexDocument>,
  query: string,
  knowledgeBaseId: string | null,
  limit = 40
): SearchResultDto[] {
  const normalized = query.trim()
  if (!normalized) return []
  return index
    .search(normalized, {
      boost: { title: 4, noteIndex: 5, content: 1 },
      combineWith: 'AND',
      prefix: true,
      fuzzy: (term) => (term.length >= 5 ? 0.16 : false),
      filter: (result) => !knowledgeBaseId || result.knowledgeBaseId === knowledgeBaseId
    })
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map((result) => ({
      knowledgeBaseId: result.knowledgeBaseId as string,
      knowledgeBaseName: result.knowledgeBaseName as string,
      noteUuid: result.noteUuid as string,
      noteIndex: result.noteIndex as string,
      title: result.title as string,
      snippet: searchSnippet(result.content as string, normalized),
      score: result.score
    }))
}
