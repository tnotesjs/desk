import type { Ref } from 'vue'

import type { SearchResultDto } from '../../../../shared/contracts'

import { resultValue } from './helpers'

export interface SearchContext {
  searchResults: Ref<SearchResultDto[]>
  searchLoading: Ref<boolean>
  selectedKnowledgeBaseId: Ref<string | null>
  error: Ref<string | null>
}

export function createSearch(ctx: SearchContext) {
  let searchSequence = 0

  async function searchNotes(query: string): Promise<void> {
    const sequence = (searchSequence += 1)
    const normalized = query.trim()
    if (!normalized || !ctx.selectedKnowledgeBaseId.value) {
      ctx.searchResults.value = []
      ctx.searchLoading.value = false
      return
    }
    ctx.searchLoading.value = true
    try {
      const results = resultValue(
        await window.desk.search({
          query: normalized,
          knowledgeBaseId: ctx.selectedKnowledgeBaseId.value,
          limit: 50
        })
      )
      if (sequence === searchSequence) ctx.searchResults.value = results
    } catch (cause) {
      if (sequence === searchSequence) {
        ctx.error.value = cause instanceof Error ? cause.message : String(cause)
        ctx.searchResults.value = []
      }
    } finally {
      if (sequence === searchSequence) ctx.searchLoading.value = false
    }
  }

  return { searchNotes }
}

export type SearchApi = ReturnType<typeof createSearch>
