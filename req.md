# LeafReader Requirements and Implementation Plan

## 1. Product Positioning

- Product name: `LeafReader`
- Form: local-first RSS reader for mobile web, installable PWA, and Android APK package
- Core stack: `Vue 3` + `Vite` + `Vant UI`
- Storage: `IndexedDB` for structured data, `localStorage` for lightweight settings
- Deployment: static frontend hosting + one self-owned `Cloudflare Worker`
- Data model: no account, no cloud sync, no backend database, no user data upload
- Design target: close to `EgoReader` in information architecture and mobile reading flow

## 2. Final Platform Targets

### 2.1 iOS

- Open in Safari
- Add to Home Screen
- Run as standalone PWA
- Free to use, no Apple Developer Program requirement
- Use configured private Worker to solve RSS and article fetching issues

### 2.2 Android

- Open in browser as PWA
- Also support packaging as APK
- Recommended packaging path: `Capacitor + Android Studio`
- APK is built from the same frontend codebase
- Worker remains the same and is not bundled into Android code

### 2.3 Desktop Browsers

- Full web usage supported
- Same local-first data behavior

## 3. High-Level Goals

- Build a stable local RSS reader with no public proxy dependency
- Make proxy and fetch service user-configurable and self-hosted
- Support feed subscription management, article reading, favorites, read state, categories, and OPML import/export
- Add full-text extraction for article detail pages
- Add offline article package support, including offline image download
- Keep frontend static-only; server logic is limited to a Cloudflare Worker fetch layer
- Support Android APK output from the same frontend project

## 4. Non-Goals

- No user login
- No remote sync in first phase
- No backend database
- No App Store release requirement
- No mandatory push notifications
- No public shared proxy fallback

## 5. Core Principles

- Local-first: all user data stays on the device
- Stable-first: use one self-owned Worker instead of third-party public proxy services
- Mobile-first: single-column, thumb-friendly interaction
- Progressive enhancement: core RSS first, full-text and offline extras second
- User-controlled networking: frontend never hardcodes a public proxy

## 6. Architecture Overview

### 6.1 Frontend

- Framework: `Vue 3`
- Build tool: `Vite`
- UI library: `Vant`
- State management: `Pinia`
- Router: `Vue Router`
- PWA: `vite-plugin-pwa`

### 6.2 Local Data

- `IndexedDB`
  - subscriptions
  - categories
  - articles
  - offline assets metadata
  - sync metadata
- `localStorage`
  - Worker base URL
  - theme
  - font size
  - reading preferences
  - UI state

### 6.3 Network Layer

- Single self-owned `Cloudflare Worker`
- Worker responsibilities:
  - RSS/Atom proxy fetch
  - full-text article extraction
  - image and static asset proxying

### 6.4 Offline Layer

- `Service Worker` caches static shell
- `Cache Storage` stores downloaded article images and other offline assets
- `IndexedDB` stores local offline asset mapping and offline HTML snapshots

### 6.5 Android Packaging

- `Capacitor`
- Web assets built by Vite
- Capacitor Android project generates APK/AAB in Android Studio or Gradle

## 7. Unified Worker Design

Use a single Worker base URL. Current default:

- `https://leafreader-worker.qixiang-xu.workers.dev`

Frontend stores this base URL and derives endpoints from it.

### 7.1 Endpoints

#### `GET /rss?url=`

- Input: encoded feed URL
- Output: original XML body
- Purpose: solve feed fetch CORS restrictions

#### `GET /extract?url=`

- Input: encoded article URL
- Output: JSON full-text extraction result
- Purpose: fetch article page and extract clean readable content

#### `GET /asset?url=`

- Input: encoded asset URL
- Output: original binary response, primarily for images
- Purpose: support cross-origin image download and offline asset storage

#### `OPTIONS /*`

- Handle CORS preflight requests

### 7.2 Worker Security Constraints

- Allow only `GET` and `OPTIONS`
- Allow only `http` and `https` target URLs
- Block localhost and private network targets
- Apply response size limits
- Restrict content type by endpoint intent
- Add CORS headers
- Optionally allow origin whitelist or token-based verification

### 7.3 Worker Caching Strategy

- RSS: short cache
- Extracted HTML: medium cache
- Images: long cache
- Use Cloudflare cache where practical, but keep the service stateless

## 8. Frontend Functional Scope

### 8.1 Subscription Management

- Add subscription by feed URL
- Edit subscription
- Delete subscription
- Assign category
- Refresh single subscription
- Refresh all subscriptions with concurrency limits

### 8.2 Category Management

- Add category
- Rename category
- Delete category
- Reassign subscriptions on category deletion

### 8.3 Article Features

- List articles by time desc
- Filter by all, unread, favorite, category, subscription
- Mark read/unread
- Favorite/unfavorite
- Search local articles

### 8.4 Reading Features

- Feed content rendering
- Full-text rendering
- Font size adjustment
- Theme support
- Read mode selection
- Open original article link

### 8.5 OPML

- Import OPML
- Export OPML
- Preserve category hierarchy where practical

### 8.6 Settings

- Worker base URL input and persistence
- Theme mode
- Font size
- Auto mark read behavior
- Reading preference
- Offline save policy
- Data cleanup controls

## 9. Full-Text Extraction Plan

### 9.1 Why It Is Needed

- Many feeds only provide summaries
- Good mobile reading requires article-focused content
- Full-text extraction improves readability and offline usefulness

### 9.2 Trigger Strategy

- Default strategy: fetch full text on demand
- Trigger points:
  - user opens article and requests full text
  - user saves article for offline reading
  - optional future setting for automatic extraction on open

### 9.3 Result Structure

Worker returns:

```json
{
  "url": "https://example.com/post/1",
  "finalUrl": "https://example.com/post/1",
  "title": "Title",
  "byline": "Author",
  "siteName": "Site",
  "excerpt": "Summary",
  "publishedTime": "2026-03-13T08:00:00.000Z",
  "lang": "zh-CN",
  "contentHtml": "<article>...</article>",
  "textContent": "Plain text",
  "leadImageUrl": "https://example.com/image.jpg"
}
```

### 9.4 Frontend Fallback Logic

- If full-text extraction succeeds, store and show it
- If extraction fails, fall back to feed content
- Never blank the page because extraction failed

## 10. Offline Article and Image Plan

### 10.1 Offline Levels

- Level 1: app shell offline
- Level 2: already stored article text offline
- Level 3: full-text article offline
- Level 4: full-text article with local images offline

### 10.2 Default Policy

- Recommended default: manual offline save per article
- User taps `Save Offline`
- App downloads full text if needed and stores article images locally

This is safer for iOS storage quotas and simpler for first release.

### 10.3 Offline Image Flow

1. Parse article HTML for image URLs
2. Normalize to absolute URLs
3. Download through Worker `/asset`
4. Save asset response in `Cache Storage`
5. Save metadata mapping in `IndexedDB`
6. Rewrite article HTML image URLs to internal offline paths
7. Store rewritten offline HTML snapshot

### 10.4 Offline Asset Path Strategy

- Internal path example: `/__offline_asset__/img_<id>`
- Service Worker intercepts those requests and returns the cached asset

### 10.5 Cleanup Strategy

- Remove offline package for a single article
- Optional future bulk cleanup
- Keep metadata and Cache Storage in sync

## 11. PWA Strategy

### 11.1 Required Features

- `manifest.webmanifest`
- `display: standalone`
- app icons
- theme color and background color
- service worker for shell caching

### 11.2 iOS Notes

- Add Apple touch icon
- Add Apple mobile web app meta tags
- Handle safe area insets
- Expect iOS PWA limitations, but support Add to Home Screen well

### 11.3 Android Notes

- Chrome install prompt support
- Manifest-complete experience
- Same codebase later used by Capacitor Android build

## 12. Android APK Plan

### 12.1 Packaging Choice

- Use `Capacitor`
- Reason:
  - keeps Vue/Vite frontend intact
  - easy Android project generation
  - reliable webview wrapper
  - good file and platform integration options later

### 12.2 Build Flow

1. Build frontend with Vite
2. Sync web assets into Capacitor Android project
3. Open Android project in Android Studio
4. Build debug APK or release APK/AAB

### 12.3 Android Storage Behavior

- IndexedDB remains primary storage inside WebView
- Cache Storage handles offline asset binaries
- Behavior should stay close to browser PWA version

### 12.4 Why APK Is Included

- Some Android users prefer installable APK over browser PWA
- APK gives more native-app-like delivery while preserving one codebase

## 13. Information Architecture

### 13.1 Main Views

- `HomeView`: all articles / unread / favorites style feeds
- `SubscriptionsView`: categories and subscriptions management
- `FavoritesView`: favorite articles
- `SettingsView`: Worker, reading, import/export, data settings
- `ArticleView`: article reading page
- Optional `SearchView`

### 13.2 Navigation

- Bottom tab navigation on mobile
- Top bar actions for refresh, search, filters
- Article page provides read/favorite/full-text/offline actions

## 14. UX Direction

- Close to EgoReader in structure, not exact visual cloning
- Mobile-first single column
- Fast scan article rows
- Clear unread state
- Smooth transition to detail reading
- Minimal clutter, content-first design

## 15. Data Model

Database name: `leafreader-db`

### 15.1 `categories`

- `id`
- `name`
- `sortOrder`
- `createdAt`
- `updatedAt`

Indexes:

- `name`
- `sortOrder`

### 15.2 `subscriptions`

- `id`
- `title`
- `feedUrl`
- `siteUrl`
- `iconUrl`
- `categoryId`
- `description`
- `createdAt`
- `updatedAt`
- `lastFetchedAt`
- `lastSuccessAt`
- `lastError`
- `isPinned`

Indexes:

- unique `feedUrl`
- `categoryId`
- `updatedAt`

### 15.3 `articles`

- `id`
- `subscriptionId`
- `feedItemId`
- `title`
- `link`
- `author`
- `summary`
- `feedContentHtml`
- `fullContentHtml`
- `offlineContentHtml`
- `contentText`
- `contentSource`
- `publishedAt`
- `createdAt`
- `updatedAt`
- `isRead`
- `isFavorite`
- `readAt`
- `favoriteAt`
- `hasFullContent`
- `isOfflineSaved`
- `offlineSavedAt`
- `leadImageUrl`

Indexes:

- `subscriptionId`
- `publishedAt`
- `isRead`
- `isFavorite`
- `subscriptionId,publishedAt`

### 15.4 `offline_assets`

- `id`
- `articleId`
- `originalUrl`
- `localPath`
- `mimeType`
- `byteSize`
- `status`
- `createdAt`
- `updatedAt`

Indexes:

- `articleId`
- `localPath`
- `status`

### 15.5 `sync_meta`

- `id`
- `subscriptionId`
- `etag`
- `lastModified`
- `lastCursor`
- `updatedAt`

Indexes:

- `subscriptionId`

## 16. Local Settings Keys

- `leafreader_worker_base_url`
- `leafreader_theme`
- `leafreader_font_size`
- `leafreader_read_mode`
- `leafreader_auto_mark_read`
- `leafreader_list_density`
- `leafreader_last_tab`
- `leafreader_read_content_preference`
- `leafreader_auto_fetch_fulltext`
- `leafreader_offline_image_policy`

## 17. Article Reading Logic

### 17.1 Content Priority

Recommended default display order:

1. `offlineContentHtml`
2. `fullContentHtml`
3. `feedContentHtml`
4. `summary`

### 17.2 Read States

- Auto mark as read on open by default
- User can disable automatic marking

### 17.3 Favorite

- Toggle locally and update immediately

## 18. Feed Fetch and Parse Plan

### 18.1 Supported Formats

- RSS 2.0
- Atom
- RDF as best-effort compatibility

### 18.2 Fetch Rules

- All network fetches go through configured Worker base URL
- No hardcoded fallback proxy
- If Worker base URL is empty, show explicit setup guidance

### 18.3 Parsing Rules

- Use browser `DOMParser`
- Prefer fields in this order:
  - content encoded
  - content
  - summary
  - description

### 18.4 Deduplication

Priority:

1. `guid`
2. `link`
3. hash of `title + pubDate`

## 19. Search Plan

- Local-only search
- First phase search scope:
  - article title
  - subscription title
  - article plain text if available

## 20. OPML Plan

### 20.1 Import

- Accept `.opml` and `.xml`
- Parse category outlines and feed nodes
- Deduplicate by `xmlUrl`

### 20.2 Export

- Export current categories and subscriptions
- Standard OPML structure

## 21. Performance Plan

- Refresh-all concurrency limit: `3-5`
- Paginate or incremental render article lists
- Keep article cap per subscription, configurable later
- Lazy load images in article content when online
- Do not auto-download all full text and images on subscription refresh in first version

## 22. Error Handling

- Missing Worker base URL: show action-oriented error
- Invalid Worker URL: reject save or block fetch actions
- Feed fetch failure: preserve old data
- Parse failure: mark subscription error and continue app usage
- Full-text failure: fall back to feed content
- Offline asset failure: keep article readable without that image

## 23. Security and Privacy

- No analytics SDK required by default
- All personal reading data local-only
- Sanitize article HTML before rendering
- Open external links safely
- Worker does not persist user content; it only transforms and forwards responses

## 24. Implementation Milestones

### Milestone 1: App Foundation

- Create Vite Vue app
- Add Vant, Pinia, Router, PWA plugin
- Build main layout and navigation shell

### Milestone 2: Local Data Layer

- Add IndexedDB wrapper
- Add local settings service
- Define stores and shared models

### Milestone 3: RSS Pipeline

- Add Worker base URL config
- Implement feed fetch service
- Implement feed parser
- Save subscriptions and articles

### Milestone 4: Reading Experience

- Article list views
- Article detail page
- Read/favorite actions
- Theme and font size settings

### Milestone 5: Full Text and Offline

- Add full-text extraction client
- Cache extracted result
- Implement offline save flow
- Implement offline image rewriting and service worker support

### Milestone 6: Management Features

- Subscription management
- Category management
- OPML import/export
- Search

### Milestone 7: Packaging

- Add Capacitor config
- Add Android platform scaffolding guidance
- Verify production build flow

## 25. Acceptance Criteria

- App runs as static site
- App can be installed as PWA on iOS and Android
- User can configure Worker base URL in settings
- User can add feed and refresh articles through Worker
- Articles persist locally after browser restart
- Full-text extraction can be triggered and stored locally
- Offline save stores article content and images for later offline reading
- No public proxy is hardcoded or silently used
- Android packaging path exists and can generate APK from the same project

## 26. Recommended Initial Development Defaults

- Worker base URL default: `https://leafreader-worker.qixiang-xu.workers.dev`
- Theme: follow system
- Font size: `16`
- Read mode: simplified
- Auto mark read: enabled
- Full-text fetch mode: on demand
- Offline image mode: manual per article

## 27. Next Build Step

Start implementation with:

1. project scaffold
2. routing and layout shell
3. local settings + IndexedDB layer
4. Worker client services
5. subscription/article flow
6. PWA and Capacitor integration
