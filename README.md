# LeafReader

Local-first RSS reader built with `Vue 3`, `Vite`, `Vant`, `IndexedDB`, `PWA`, and a unified `Cloudflare Worker` for feed proxying, full-text extraction, and asset downloading.

## Development

```bash
npm install
npm run dev
```

Default Worker base URL:

`https://leafreader-worker.qixiang-xu.workers.dev`

If the user does not change the setting, the app uses this address by default.

## Cross-Machine Testing

Run the frontend on your LAN:

```bash
npm run dev:host
```

Then open the app from another machine with:

`http://<your-local-ip>:5173`

Example:

`http://192.168.1.23:5173`

Because the Worker is already deployed to Cloudflare, the other machine can test feed fetching and full-text extraction directly without running Worker locally.

## Frontend Build

```bash
npm run build
npm run preview
```

## Worker Development

```bash
npm run worker:dev
npm run worker:deploy
```

Worker routes:

- `/rss?url=`: fetch RSS or Atom XML
- `/extract?url=`: extract full text from article pages
- `/asset?url=`: proxy images or other binary assets

## Android APK

```bash
npm install
npm run cap:android
```

Then build APK in Android Studio.

## Key Files

- Requirements plan: `req.md`
- Frontend entry: `src/main.ts`
- App shell: `src/App.vue`
- Worker entry: `worker/src/index.ts`
- Android config: `capacitor.config.ts`
