import type { AzimApi } from '../shared/api'

declare global {
  interface Window {
    azim: AzimApi
  }
}

export {}
