import { defineStore } from 'pinia'

import { defaultSettings } from '@/constants/settings'
import { loadSettings, saveSettings } from '@/services/settings'
import type { AppSettings } from '@/types/models'

export const useSettingsStore = defineStore('settings', {
  state: (): { ready: boolean; settings: AppSettings } => ({
    ready: false,
    settings: defaultSettings
  }),
  actions: {
    initialize() {
      if (this.ready) return
      this.settings = loadSettings()
      this.ready = true
      this.applyTheme()
    },
    patchSettings(payload: Partial<AppSettings>) {
      this.settings = { ...this.settings, ...payload }
      saveSettings(this.settings)
      this.applyTheme()
    },
    applyTheme() {
      const root = document.documentElement
      const theme = this.settings.theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : this.settings.theme

      root.dataset.theme = theme
      root.style.setProperty('--reader-font-size', `${this.settings.fontSize}px`)
    }
  }
})
