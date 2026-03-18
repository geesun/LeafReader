import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.neoreader.app',
  appName: 'NeoReader',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    CapacitorHttp: {
      // Patch window.fetch and XMLHttpRequest to use the native HTTP stack.
      // This bypasses WebView CORS restrictions for all outgoing requests.
      enabled: true
    }
  }
}

export default config
