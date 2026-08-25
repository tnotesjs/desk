import { reactive } from 'vue'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

const toasts = reactive<ToastItem[]>([])
let nextId = 1

export function pushToast(message: string, kind: ToastKind = 'info', duration = 3600): void {
  const id = nextId++
  toasts.push({ id, message, kind })
  window.setTimeout(() => dismissToast(id), duration)
}

export function dismissToast(id: number): void {
  const index = toasts.findIndex((toast) => toast.id === id)
  if (index >= 0) toasts.splice(index, 1)
}

export function useToasts(): ToastItem[] {
  return toasts
}
