export function createPendingSaves() {
  const pending = new Map<string, Promise<void>>()

  function run(key: string, save: () => Promise<void>): Promise<void> {
    const existing = pending.get(key)
    if (existing) return existing
    const operation = save().finally(() => {
      if (pending.get(key) === operation) pending.delete(key)
    })
    pending.set(key, operation)
    return operation
  }

  function wait(key: string): Promise<void> {
    return pending.get(key) ?? Promise.resolve()
  }

  return { run, wait }
}
