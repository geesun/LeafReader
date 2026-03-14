import 'vant/lib/index.css'
import './styles.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'
import Vant from 'vant'
import { registerSW } from 'virtual:pwa-register'

import App from './App.vue'
import router from './router'
import { getDb } from './services/db'
import { useSettingsStore } from './stores/settings'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(Vant)

const settingsStore = useSettingsStore(pinia)
settingsStore.initialize()

void getDb()

registerSW({
  immediate: true
})

app.mount('#app')
