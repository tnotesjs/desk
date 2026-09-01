import { deleteRecovery, writeRecovery } from '../recovery'
import { workspaceManager } from '../workspaceManager'
import { IPC_CHANNELS } from '../../shared/contracts'
import { recoveryDeleteSchema, recoveryWriteSchema } from './schemas'
import { handle, type GetWindow } from './shared'

import type { RecoveryDeleteRequest, RecoveryWriteRequest } from '../../shared/contracts'

export function registerRecovery(getWindow: GetWindow): void {
  handle(IPC_CHANNELS.recoveryWrite, getWindow, recoveryWriteSchema, (request) =>
    writeRecovery(workspaceManager.getOverview().path, request as RecoveryWriteRequest)
  )
  handle(IPC_CHANNELS.recoveryDelete, getWindow, recoveryDeleteSchema, (request) =>
    deleteRecovery(workspaceManager.getOverview().path, request as RecoveryDeleteRequest)
  )
}
