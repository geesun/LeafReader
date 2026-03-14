import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.leafreader.app',
  appName: 'NeoReader',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
}

export default config
