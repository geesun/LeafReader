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

## Deployment

### Deploy Worker to Cloudflare

Requires [Wrangler](https://developers.cloudflare.com/workers/wrangler/) and a Cloudflare account. Log in once:

```bash
npx wrangler login
```

Then deploy:

```bash
npm run worker:deploy
```

The Worker will be available at:
`https://leafreader-worker.<your-subdomain>.workers.dev`

Worker routes:

- `/rss?url=`: fetch RSS or Atom XML
- `/extract?url=`: extract full text from article pages
- `/asset?url=`: proxy images or other binary assets

### Deploy Frontend to Cloudflare Pages

Build and deploy in one step:

```bash
npm run build
npx wrangler pages deploy dist --project-name leafreader --branch main
```

On first deploy, if the Pages project does not exist yet, create it first:

```bash
npx wrangler pages project create leafreader --production-branch main
```

Then run the deploy command above.

Live URLs after deployment:

- Production: `https://leafreader.pages.dev`
- Preview (per-deployment): `https://<hash>.leafreader.pages.dev`

### Worker Development (local)

```bash
npm run worker:dev
```

## Android APK

### Local build (requires Android Studio)

```bash
npm run cap:android
```

Then build APK in Android Studio.

### Automated build via GitHub Actions

Pushing a version tag triggers a CI build and creates a GitHub Release with the APK attached automatically.

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow (`.github/workflows/android-release.yml`) will:

1. Install Node dependencies and build the web assets
2. Run `cap sync android` to copy assets into the Android project
3. Build a debug-signed APK with Gradle
4. Create a GitHub Release and attach the APK

The release will appear at `https://github.com/<your-username>/LeafReader/releases`.

> The APK is signed with Android's debug key. To install it, enable "Install from unknown sources" on your Android device.

## Key Files

- Requirements plan: `req.md`
- Frontend entry: `src/main.ts`
- App shell: `src/App.vue`
- Worker entry: `worker/src/index.ts`
- Android config: `capacitor.config.ts`
