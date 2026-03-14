import type { AppSettings } from '@/types/models'

export const SETTINGS_STORAGE_KEY = 'leafreader_settings'
export const DEFAULT_WORKER_BASE_URL = 'https://leafreader-worker.qixiang-xu.workers.dev'

export const defaultSettings: AppSettings = {
  workerBaseUrl: DEFAULT_WORKER_BASE_URL,
  theme: 'system',
  fontSize: 16,
  readMode: 'simplified',
  autoMarkRead: true,
  listDensity: 'comfortable',
  readContentPreference: 'auto',
  autoFetchFullText: 'off',
  offlineImagePolicy: 'manual'
}
