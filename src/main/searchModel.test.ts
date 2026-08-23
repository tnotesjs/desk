import { describe, expect, it } from 'vitest'

import {
  createSearchIndex,
  querySearchIndex,
  searchSnippet,
  tokenizeSearchText
} from './searchModel'

import type { SearchIndexDocument } from './searchModel'

const documents: SearchIndexDocument[] = [
  {
    id: 'kb-a:note-a',
    knowledgeBaseId: 'kb-a',
    knowledgeBaseName: 'docs',
    noteUuid: 'note-a',
    noteIndex: '0038',
    title: '后台搜索索引',
    content: '# 后台搜索索引\n\nDesk 使用独立线程维护全文搜索，不阻塞编辑器。',
    revision: 'a'
  },
  {
    id: 'kb-b:note-b',
    knowledgeBaseId: 'kb-b',
    knowledgeBaseName: 'other',
    noteUuid: 'note-b',
    noteIndex: '0001',
    title: '编辑器说明',
    content: '这里也提到了搜索，但属于另一个知识库。',
    revision: 'b'
  }
]

describe('search model', () => {
  it('tokenizes Chinese and Latin words', () => {
    expect(tokenizeSearchText('Desk 后台搜索')).toEqual(
      expect.arrayContaining(['desk', '后台', '搜索'])
    )
  })

  it('searches title and content within one knowledge base', () => {
    const index = createSearchIndex(documents)
    expect(querySearchIndex(index, '后台搜索', 'kb-a')).toMatchObject([
      { knowledgeBaseId: 'kb-a', noteUuid: 'note-a', noteIndex: '0038' }
    ])
    expect(querySearchIndex(index, '搜索', 'kb-b')).toMatchObject([
      { knowledgeBaseId: 'kb-b', noteUuid: 'note-b' }
    ])
  })

  it('creates a compact plain-text excerpt', () => {
    expect(
      searchSnippet('## 标题\n\n这是 **正文** 和 [链接](https://example.com)。', '正文')
    ).toContain('这是 **正文**')
  })
})
