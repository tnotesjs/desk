import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { insertTableCommand } from '@milkdown/kit/preset/gfm'

/** Two rows total: one empty header row and one empty body row, each with two cells. */
export function insertDefaultTable(ctx: Ctx, source: 'toolbar' | 'slash' = 'toolbar'): void {
  const view = ctx.get(editorViewCtx)
  if (!view.editable) return
  const commands = ctx.get(commandsCtx)
  if (source === 'slash') commands.call(clearTextInCurrentBlockCommand.key)
  commands.call(insertTableCommand.key, { row: 2, col: 2 })
  view.focus()
}
