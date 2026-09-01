import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'

import type { ProjectedRawBlockKind } from '../../editor/markdown/rawBlockProjection'
import type { AttachRawSourceEditorDeps } from '../attachRawSourceEditor'

export interface DeskRawBlockViewDeps extends AttachRawSourceEditorDeps {
  knowledgeBaseId: () => string
  noteUuid: () => string
  uploadImage: (file: File) => Promise<{ src: string; alt: string }>
  writeClipboard: (text: string) => Promise<void>
}

export interface DeskRawBlockMountContext {
  block: {
    kind: ProjectedRawBlockKind
    source: string
    hidden: boolean
  }
  dom: HTMLElement
  view: EditorView
  getPos: () => number | undefined
  cleanupTasks: Array<() => void>
  getCurrentRawNode: () => ProseNode
  setCurrentRawNode: (node: ProseNode) => void
  resolveImage: (source: string) => string
  deps: DeskRawBlockViewDeps
}
