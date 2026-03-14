import { SETTINGS_STORAGE_KEY, defaultSettings } from '@/constants/settings'
import type { AppSettings } from '@/types/models'

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
      ...parsed
    }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}
