import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'

import { deskLog } from './log'
import { workspaceManager } from './workspaceManager'

const SCHEME = 'tnotes-asset'

export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])
}

export function handleAssetProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'asset') return new Response('Not found', { status: 404 })
      const knowledgeBaseId = url.searchParams.get('knowledgeBaseId') ?? ''
      const noteUuid = url.searchParams.get('noteUuid') ?? ''
      const requestedPath = url.searchParams.get('path') ?? ''
      const absolutePath = await workspaceManager.resolveNoteAsset(
        knowledgeBaseId,
        noteUuid,
        requestedPath
      )
      return net.fetch(pathToFileURL(absolutePath).toString())
    } catch (error) {
      deskLog(
        'asset-protocol',
        'request rejected',
        error instanceof Error ? error.message : String(error)
      )
      return new Response('Not found', { status: 404 })
    }
  })
}
