import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.neoreader.app',
  appName: 'NeoReader',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
}

export default config
