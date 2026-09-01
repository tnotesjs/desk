import type { Ref } from 'vue'

import type {
  AppSettings,
  GitRepositoryStateDto,
  WorkspaceOverview
} from '../../../../shared/contracts'

import { resultValue, type GitAttention } from './helpers'

export interface GitContext {
  gitStates: Ref<Record<string, GitRepositoryStateDto>>
  gitAttention: Ref<GitAttention | null>
  pendingGitPublishId: Ref<string | null>
  overview: Ref<WorkspaceOverview>
  settings: Ref<AppSettings | null>
  error: Ref<string | null>
  status: Ref<string | null>
  saveAllDocuments: () => Promise<void>
  refreshWorkspace: () => Promise<void>
}

export function createGit(ctx: GitContext) {
  async function refreshGit(knowledgeBaseId?: string): Promise<void> {
    try {
      const states = resultValue(await window.desk.git.refresh(knowledgeBaseId))
      ctx.gitStates.value = Object.fromEntries(
        states.map((state) => [state.knowledgeBaseId, state])
      )
    } catch (cause) {
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function fetchGit(knowledgeBaseId: string): Promise<void> {
    try {
      const result = resultValue(await window.desk.git.fetch(knowledgeBaseId))
      ctx.gitStates.value = { ...ctx.gitStates.value, [knowledgeBaseId]: result.state }
      ctx.status.value = result.message
    } catch (cause) {
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function pullGit(knowledgeBaseId: string): Promise<void> {
    try {
      const result = resultValue(await window.desk.git.pull(knowledgeBaseId))
      ctx.gitStates.value = { ...ctx.gitStates.value, [knowledgeBaseId]: result.state }
      if (result.conflict) {
        const descriptor = ctx.overview.value.allKnowledgeBases.find(
          (item) => item.id === knowledgeBaseId
        )
        ctx.gitAttention.value = {
          knowledgeBaseId,
          knowledgeBaseName: descriptor?.displayName ?? result.state.knowledgeBaseName,
          kind: 'conflict',
          message: result.message
        }
      } else {
        ctx.gitAttention.value = null
        ctx.status.value = result.message
        await ctx.refreshWorkspace()
      }
    } catch (cause) {
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function requestGitPublish(knowledgeBaseId: string): void {
    if (ctx.settings.value?.confirmBeforeCommit) {
      ctx.pendingGitPublishId.value = knowledgeBaseId
    } else {
      void publishGit(knowledgeBaseId)
    }
  }

  async function publishGit(knowledgeBaseId: string): Promise<void> {
    ctx.pendingGitPublishId.value = null
    try {
      await ctx.saveAllDocuments()
      const result = resultValue(await window.desk.git.publish(knowledgeBaseId))
      ctx.gitStates.value = { ...ctx.gitStates.value, [knowledgeBaseId]: result.state }
      ctx.status.value = result.message
    } catch (cause) {
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function openKnowledgeBaseInIde(knowledgeBaseId: string): Promise<void> {
    const result = await window.desk.ide.openKnowledgeBase(knowledgeBaseId)
    if (!result.ok) ctx.error.value = result.error.message
  }

  return {
    refreshGit,
    fetchGit,
    pullGit,
    requestGitPublish,
    publishGit,
    openKnowledgeBaseInIde
  }
}

export type GitApi = ReturnType<typeof createGit>
