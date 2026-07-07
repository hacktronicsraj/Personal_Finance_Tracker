# Personal Finance Tracker

Android (Expo) personal finance tracker that reads bank/UPI SMS, classifies each
transaction with an LLM via a serverless Cloudflare backend, and notifies you to
confirm/correct the category right after a payment.

- `server/` — Cloudflare Worker (Hono + D1). Source of truth for transactions & analytics.
- `mobile/` — Expo app (Android-only, custom dev build). Reads SMS, local cache, notifications.

**Deploying?** Follow [DEPLOY.md](./DEPLOY.md) — step-by-step Cloudflare + APK instructions.
Design mockups: [design/ui-mockups.html](./design/ui-mockups.html).

## Quick start

### Backend
```bash
cd server
npm install
npm run db:init         # create local D1 tables
npm run dev             # wrangler dev on http://localhost:8787
npm test                # unit tests
npm run smoke           # end-to-end curl smoke test (needs `npm run dev` running)
```
By default the backend runs the LLM in **mock mode** (rule-based classifier) so it
works offline. Set real secrets to use a live OpenAI-compatible model:
```bash
wrangler secret put LLM_API_KEY
# and set LLM_BASE_URL / LLM_MODEL in wrangler.toml [vars]
```

### Mobile
```bash
cd mobile
npm install
npm test                # parser unit tests (runnable anywhere)
npx expo prebuild -p android
eas build -p android --profile preview   # or development
```
Install the APK on your Android phone, grant SMS + notification permissions,
enter the backend URL + API token in Settings.
