import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { Plugin } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

export interface ReadonlyTransactionGuardOptions {
  isReadOnly: () => boolean
  isExternalSync: () => boolean
}

/**
 * Final document-level safety net for readonly mode.
 *
 * `contenteditable=false` blocks native typing, but custom NodeViews and other
 * plugins can still dispatch transactions directly. Reject every document
 * mutation while readonly, except the explicitly-scoped transaction used to
 * refresh content that changed outside the editor.
 */
export function createReadonlyTransactionGuard(
  options: ReadonlyTransactionGuardOptions
): MilkdownPlugin {
  return $prose(
    () =>
      new Plugin({
        filterTransaction: (transaction) =>
          !transaction.docChanged || !options.isReadOnly() || options.isExternalSync()
      })
  )
}
