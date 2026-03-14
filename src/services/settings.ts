import { SETTINGS_STORAGE_KEY, defaultSettings } from '@/constants/settings'
import type { AppSettings } from '@/types/models'
import { normalizeBaseUrl } from '@/utils/url'

export function loadSettings(): AppSettings {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
  if (!raw) {
    saveSettings(defaultSettings)
    return defaultSettings
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      ...defaultSettings,
      ...parsed,
      workerBaseUrl: normalizeBaseUrl(parsed.workerBaseUrl ?? '')
    }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({
      ...settings,
      workerBaseUrl: normalizeBaseUrl(settings.workerBaseUrl)
    })
  )
}
