import type { AppSettings } from '@/types/models'

export const SETTINGS_STORAGE_KEY = 'neoreader_settings'
export const DEFAULT_WORKER_BASE_URL = 'https://neoreader-worker.qixiang-xu.workers.dev'

export const defaultSettings: AppSettings = {
  theme: 'system',
  fontSize: 16
}
