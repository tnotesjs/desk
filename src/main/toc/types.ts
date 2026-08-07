/**
 * Minimal note types for Desk TOC (adapted from @tnotesjs/core).
 */

export interface NoteConfig {
  id: string
  bilibili: string[]
  tnotes: string[]
  yuque: string[]
  done: boolean
  category?: string
  enableDiscussions: boolean
  description?: string
}

export interface NoteInfo {
  index: string
  path: string
  dirName: string
  readmePath: string
  configPath: string
  config?: NoteConfig
}
