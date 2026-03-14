import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
  state: () => ({
    tabbarHidden: false
  }),
  actions: {
    setTabbarHidden(hidden: boolean) {
      this.tabbarHidden = hidden
    }
  }
})
