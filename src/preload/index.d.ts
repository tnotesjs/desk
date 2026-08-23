import type { DeskApi } from '../shared/contracts'

declare global {
  interface Window {
    desk: DeskApi
  }
}
