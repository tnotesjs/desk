import { z } from 'zod'

import type { WorkspaceSession } from '../../shared/contracts'

const iconSchema = z
  .object({
    src: z.string().optional(),
    svg: z.string().optional()
  })
  .nullable()

const noteTabSchema = z.object({
  id: z.string().min(1),
  type: z.literal('note'),
  knowledgeBaseId: z.string().min(1),
  knowledgeBaseName: z.string(),
  noteUuid: z.string().min(1),
  title: z.string(),
  icon: iconSchema,
  viewMode: z.enum(['visual', 'readonly', 'source']),
  pageWidth: z.enum(['standard', 'wide']).default('standard'),
  preview: z.boolean().optional(),
  pinned: z.boolean().optional(),
  openedAt: z.number().finite().optional(),
  dirty: z.boolean().optional()
})

const webTabSchema = z.object({
  id: z.string().min(1),
  type: z.literal('web'),
  url: z.string().min(1),
  title: z.string(),
  pinned: z.boolean().optional(),
  openedAt: z.number().finite().optional()
})

const noteFileTabSchema = z.object({
  id: z.string().min(1),
  type: z.literal('note-file'),
  knowledgeBaseId: z.string().min(1),
  knowledgeBaseName: z.string(),
  noteUuid: z.string().min(1),
  noteTitle: z.string(),
  path: z.string().min(1).max(1024),
  title: z.string(),
  fileKind: z.enum(['text', 'image', 'unsupported']),
  pinned: z.boolean().optional(),
  openedAt: z.number().finite().optional(),
  dirty: z.boolean().optional()
})

const editorTabSchema = z.discriminatedUnion('type', [
  noteTabSchema,
  noteFileTabSchema,
  webTabSchema
])

const editorLayoutSchema: z.ZodType<WorkspaceSession['layout']> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('group'),
      id: z.string().min(1),
      tabs: z.array(editorTabSchema),
      activeTabId: z.string().nullable()
    }),
    z.object({
      type: z.literal('split'),
      id: z.string().min(1),
      direction: z.enum(['horizontal', 'vertical']),
      ratio: z.number().min(0.15).max(0.85),
      first: editorLayoutSchema,
      second: editorLayoutSchema
    })
  ])
)

const knowledgeBaseEditorSchema = z.object({
  layout: editorLayoutSchema,
  activeGroupId: z.string().min(1),
  lastNoteByGroup: z
    .record(z.string(), z.object({ noteUuid: z.string().min(1), noteTitle: z.string() }))
    .optional()
})

export const workspaceSessionSchema = z.object({
  version: z.literal(1),
  selectedKnowledgeBaseId: z.string().nullable(),
  layout: editorLayoutSchema,
  activeGroupId: z.string().min(1),
  knowledgeBaseEditors: z.record(z.string(), knowledgeBaseEditorSchema).default({}),
  knowledgeSidebarWidth: z.number().min(48).max(520),
  navigatorSidebarWidth: z.number().min(160).max(700),
  knowledgeSidebarCollapsed: z.boolean(),
  navigatorSidebarCollapsed: z.boolean(),
  expandedTocNodes: z.record(z.string(), z.array(z.string())),
  noteFileSidebarWidth: z.number().min(160).max(520).default(240),
  noteFileSidebarCollapsed: z.boolean().default(false),
  expandedNoteFileDirectories: z.record(z.string(), z.array(z.string())).default({})
})

export const webBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive()
})

export const entryRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('note'), noteUuid: z.string().min(1) }),
  z.object({
    type: z.literal('folder'),
    folderPath: z.array(z.string().min(1)).min(1)
  }),
  z.object({
    type: z.literal('line'),
    tocLineIndex: z.number().int().nonnegative()
  })
])

export const placementSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('root'),
    placement: z.enum(['start', 'end']).optional()
  }),
  z.object({
    type: z.literal('note'),
    targetNoteUuid: z.string().min(1),
    placement: z.enum(['before', 'after', 'inside'])
  }),
  z.object({
    type: z.literal('folder'),
    folderPath: z.array(z.string().min(1)).min(1),
    placement: z.enum(['before', 'after', 'inside'])
  })
])

export const noteSaveSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  content: z.string(),
  expectedRevision: z.string().min(1),
  prettier: z.boolean().optional()
})

export const noteCreateSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  title: z.string().min(1),
  placement: placementSchema.optional(),
  expectedSnapshotRevision: z.string().min(1).optional()
})

export const noteRenameSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  title: z.string().min(1),
  expectedRevision: z.string().min(1)
})

export const noteUpdateConfigSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  expectedRevision: z.string().min(1),
  updates: z
    .object({
      done: z.boolean().optional(),
      description: z.string().optional(),
      enableDiscussions: z.boolean().optional()
    })
    .refine((value) => Object.keys(value).length > 0, '没有可更新字段')
})

export const recoveryWriteSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  path: z.string().min(1).max(1024).optional(),
  title: z.string(),
  content: z.string(),
  revision: z.string().min(1)
})

export const recoveryDeleteSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  path: z.string().min(1).max(1024).optional()
})

export const noteFilesListSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  directory: z.string().max(1024).optional()
})

export const noteFileReadTextSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  path: z.string().min(1).max(1024)
})

export const noteFileSaveTextSchema = noteFileReadTextSchema.extend({
  content: z.string().max(2 * 1024 * 1024),
  expectedRevision: z.string().min(1)
})

export const attachmentWriteLocalSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  fileName: z.string().min(1).max(240),
  data: z.instanceof(Uint8Array).refine((data) => data.byteLength <= 25 * 1024 * 1024, {
    message: '图片不能超过 25 MB'
  })
})

export const attachmentReadTextSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  path: z.string().min(1).max(1024)
})

export const attachmentWriteTextSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  path: z.string().min(1).max(1024),
  content: z.string().max(2 * 1024 * 1024)
})

export const githubImageSettingsSchema = z.object({
  repository: z.string().trim().min(1).max(300),
  branch: z.string().trim().min(1).max(240),
  path: z.string().trim().max(1024),
  cdnTemplate: z.string().trim().min(1).max(2048),
  fileNameFormat: z.string().trim().min(1).max(240)
})

export const tocMoveSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  source: entryRefSchema,
  target: entryRefSchema,
  placement: z.enum(['before', 'after', 'inside']),
  expectedSnapshotRevision: z.string().min(1)
})

export const tocCreateGroupSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  title: z.string().min(1),
  placement: placementSchema.optional(),
  expectedSnapshotRevision: z.string().min(1)
})

export const tocRenameGroupSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  folderPath: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  expectedSnapshotRevision: z.string().min(1)
})

export const tocDeleteSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  entry: entryRefSchema,
  expectedSnapshotRevision: z.string().min(1)
})
