# Deploying the Personal Finance Tracker

Two things get deployed:

1. **Backend** → Cloudflare Worker + D1 (free tier, ~10 minutes)
2. **App** → an APK sideloaded on your Android phone (EAS cloud build or local build)

Everything here is copy-paste. Commands run from the repo root unless noted.

---

## 0. Prerequisites

| What | Why | Get it |
|---|---|---|
| Cloudflare account (free) | Worker + D1 | https://dash.cloudflare.com/sign-up |
| Node 20+ / npm | build tooling | already installed |
| An OpenAI-compatible LLM key *(optional at first)* | live classification | Groq / Gemini / OpenRouter / OpenAI |
| Expo account (free) *(only for cloud builds)* | EAS build | https://expo.dev/signup |
| Android phone with developer mode | install the APK | Settings → About → tap Build number 7× |

> **No LLM key yet?** Skip it. The backend ships with `LLM_MODE=mock` — an offline
> rule-based classifier — so you can deploy today and add the key later.

---

## 1. Deploy the backend (Cloudflare Worker + D1)

### 1.1 Login

```bash
cd server
npm install
npx wrangler login        # opens browser, authorize Wrangler
```

### 1.2 Create the D1 database

```bash
npx wrangler d1 create pft
```

The output prints a `database_id`. Put it in `server/wrangler.toml`, replacing the placeholder:

```toml
[[d1_databases]]
binding = "DB"
database_name = "pft"
database_id = "<paste-the-real-id-here>"
```

### 1.3 Create the tables (remote)

```bash
npm run db:init:remote     # applies schema.sql to the real D1
```

### 1.4 Set the API token (auth for your app)

```bash
openssl rand -hex 32       # generate a token, copy it
npx wrangler secret put API_TOKEN   # paste when prompted
```

Keep this token — you'll enter it in the app's Settings screen.

### 1.5 Set the Gemini key

The repo is already configured for **Google Gemini** (`wrangler.toml` points at
Gemini's OpenAI-compatible endpoint with `gemini-flash-latest`, free tier).
Just set your key — from https://aistudio.google.com/apikey — as a secret:

```bash
npx wrangler secret put LLM_API_KEY   # paste the Gemini key when prompted
```

Notes:
- The key lives only in Cloudflare secrets (and `.dev.vars` locally, which is
  gitignored) — never in `wrangler.toml`.
- If the secret isn't set yet or a Gemini call fails, the Worker automatically
  falls back to the built-in rule classifier — a transaction is never lost.
- **Switching providers later** (all OpenAI-compatible) — edit `[vars]`:

| Provider | LLM_BASE_URL | Suggested LLM_MODEL | Cost |
|---|---|---|---|
| Gemini *(current)* | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-flash-latest` | free tier |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | free tier |
| OpenRouter | `https://openrouter.ai/api/v1` | any model id | varies |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | ~₹0.01/txn |

### 1.6 Deploy & verify

```bash
npm run deploy
```

Note the printed URL, e.g. `https://pft.<your-subdomain>.workers.dev`, then:

```bash
curl https://pft.<you>.workers.dev/health
# → {"ok":true,"mode":"mock"}   (or "live")

curl -X POST https://pft.<you>.workers.dev/classify \
  -H "authorization: Bearer <YOUR_API_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"deviceId":"test","rawText":"IDBI Bank Acct XX417 debited for Rs 350.00 on 02-Jul-26; Bal Rs 82.58 SWIGGY credited. UPI:111.","parsed":{"amount":350,"direction":"debit","merchant":"SWIGGY","accountTail":"417","refNo":"111","occurredAt":"2026-07-02T00:00:00.000Z"}}'
# → {"transaction":{...,"category":"Food & Dining",...},"deduped":false}
```

Both respond correctly? Backend is done.

---

## 2. Build & install the app

SMS reading **cannot work in Expo Go** — you must build a real APK. Pick one path.

### Path A — EAS cloud build (no Android SDK needed)

```bash
cd mobile
npm install
npx eas-cli login                       # your free Expo account
npx eas-cli build -p android --profile preview
```

- First run may ask to create the project on expo.dev — accept defaults.
- Wait ~10–15 min; the terminal (and expo.dev) gives an **APK download link / QR**.
- Open the link on your phone, download, and install (allow "install unknown apps").

The `preview` profile (already in `mobile/eas.json`) produces an installable APK.
Free tier includes a monthly quota of Android builds — plenty for personal use.

### Path B — local build (unlimited, needs Android tooling)

Requires Android Studio (or at least the SDK) + JDK 17, and your phone connected
via USB with USB-debugging on:

```bash
cd mobile
npm install
npx expo run:android --variant release   # builds and installs straight onto the phone
```

(The generated project signs release builds with the debug keystore — fine for
personal sideloading.)

---

## 3. First-run setup on the phone

1. Open **Finance Tracker** → onboarding screen.
2. Enter:
   - **Backend URL**: `https://pft.<you>.workers.dev` (no trailing slash)
   - **API token**: the one from step 1.4
3. Tap **Continue** → grant **SMS** and **Notification** permissions when prompted.
4. The app imports your existing inbox (financial SMS only; OTPs are ignored) and syncs.

### 3.5 Turn on reliable capture (do this once)

The app captures spending three ways — set them all up once:

1. **Share (most reliable).** After any payment, tap **Share** in Google Pay / PhonePe /
   Paytm → **Finance Tracker**. PhonePe/Paytm share text; **Google Pay shares a
   receipt screenshot** — the app sends that image to your backend and Gemini Flash
   reads the amount and payee off it (vision, free tier). A confirm screen appears →
   check the amount/category → **Save**.
2. **Background bank SMS (automatic backstop).** Grant SMS permission (step 3). Spends
   that trigger a bank debit SMS are logged on their own, even when the app is closed.
3. **Keep it alive on aggressive phones.** Settings → **Background reliability** →
   *Allow unrestricted battery* and (on Xiaomi/Oppo/Vivo/Realme/OnePlus/Huawei)
   *Enable autostart*. This is what stops Android from killing background capture.
   It does **not** drain the battery — capture is event-driven, nothing polls.

> Only **spending** is tracked (received money is ignored). Sharing a payment that
> also produced a bank SMS won't double-count — the backend merges the two.

### Verify end-to-end

- Make any small UPI payment (or wait for the next bank SMS).
- Within seconds: notification **"₹X spent · MERCHANT — Best guess: … Confirm?"**
- Or share the payment from GPay/PhonePe/Paytm → confirm screen → Save.
- Tap a category button → open the app → Home shows the transaction and updated totals.
- Check the server side too:

```bash
cd server
npx wrangler d1 execute pft --remote \
  --command "SELECT merchant, amount, category, corrected FROM transactions ORDER BY created_at DESC LIMIT 5"
```

---

## 4. Updating later

| Change | Command |
|---|---|
| Backend code / prompt / rules | `cd server && npm run deploy` |
| Switch LLM provider/model | edit `[vars]` in `wrangler.toml`, `npx wrangler secret put LLM_API_KEY`, redeploy |
| App JS / screens / parser | `cd mobile && npm run ota "what changed"` — lands on the phone, no cable |
| App native side (new module, permission, config plugin) | rebuild the APK (step 2) |
| DB schema change | add SQL to `schema.sql` (it's idempotent), then `npm run db:migrate` |
| Retrain the classifier from history | `cd server && node scripts/train.mjs` to preview, `--apply` to write |

### Upgrading to the share + reliability version

1. **Backend:** `cd server && npm run db:init:remote` (adds the idempotent
   `dedupe_alias` table used by the cross-source merge) then `npm run deploy`.
2. **App:** `cd mobile && npm install` (pulls the new share/background/vision deps),
   then rebuild with a clean prebuild so the share-sheet target is registered:
   `npx expo run:android --variant release` (Path B) or `eas build` (Path A).
   Reading Google Pay screenshots reuses your existing `LLM_API_KEY` — no extra config.

### Over-the-air updates (EAS Update)

JS and asset changes ship straight to the phone — no cable, no reinstall. Native
changes cannot: a new native module, an Android permission, or an edit to the
`withSmsReceiver` / `withSpendWidget` plugins still needs a rebuilt APK. The
`fingerprint` runtime-version policy enforces this automatically — a build only
receives updates whose native fingerprint matches, so a JS bundle can never land
on an APK that lacks the native code it calls.

Cost: EAS Update's free tier covers well beyond a single-user app.

**One-time setup** (interactive — run these yourself):

```bash
cd mobile
npx eas login                 # or: npx eas-cli@latest login
npx eas init                  # creates the EAS project, writes extra.eas.projectId
npx eas update:configure      # writes the updates.url into app.config.ts
```

Then rebuild the APK **once** so it contains the updates runtime and channel:

```bash
npm run build:apk             # production profile → channel "production"
```

Install that APK. From then on:

```bash
npm run ota "fix airtel bill reminders"      # → production channel
npm run ota:preview "trying something"        # → preview channel
```

The app checks on launch and downloads in the background; it applies on the next
start. To pull one immediately: **Settings → App updates → Check for updates**,
then *Restart to apply*.

**Rollback** — republish a known-good bundle to the branch:

```bash
npx eas update:list --branch production      # find the update you want
npx eas update:republish --group <id>
```

---

## 5. Troubleshooting

- **`401 unauthorized` from the backend** — token in app Settings doesn't match the
  `API_TOKEN` secret. Re-save it in Settings → Test.
- **Every transaction classified by rules (`notes: "…;llm-fallback"`)** — the live
  LLM call is failing: check `LLM_BASE_URL`/`LLM_MODEL` in `[vars]` and the
  `LLM_API_KEY` secret; watch live logs with `npx wrangler tail`.
- **A spend was missed while the app was killed** — by design the app only captures
  **live** incoming SMS (no inbox history scan). If the OEM killed the receiver and a
  message slipped through, just **share** the payment screenshot or add it manually.
  To make the live receiver more reliable, set up Settings → *Background reliability*
  (battery + autostart).
- **Sharing a Google Pay payment does nothing / no amount** — GPay shares a
  screenshot, so extraction needs a **live vision model**. Confirm `LLM_API_KEY`
  is set and `LLM_MODEL` is multimodal (Gemini Flash is). With no live model the
  share still opens the confirm screen — just type the amount in.
- **A shared/manual spend won't save** — check the backend URL/token in Settings →
  Test. Offline saves are queued and flushed on next sync.
- **"App was denied access · restricted permission" when granting SMS** — Android 13+
  blocks *sideloaded* apps from restricted permissions (SMS/notification-access) by
  design. Unblock it: **Settings → Apps → Finance Tracker → ⋮ (top-right) → Allow
  restricted settings**, confirm with PIN/fingerprint, then grant SMS + Notifications.
  If that menu item is missing (some OEMs), grant over USB instead:
  ```
  adb shell pm grant com.personal.financetracker android.permission.READ_SMS
  adb shell pm grant com.personal.financetracker android.permission.RECEIVE_SMS
  adb shell pm grant com.personal.financetracker android.permission.POST_NOTIFICATIONS
  ```
- **SMS permission dialog never appeared** — you're running in Expo Go or denied it
  permanently. Use the real APK; enable SMS in Android Settings → Apps →
  Finance Tracker → Permissions.
- **Non-IDBI bank SMS not parsed** — add a sample of the format to
  `mobile/src/parse/parser.test.ts`, extend `parser.ts`, `npm test`, rebuild.

---

## 6. What this costs

- **Cloudflare Workers/D1:** ₹0 (free tier: 100k requests/day, 5 GB — you'll use <1%).
- **LLM:** ₹0 on Groq/Gemini free tiers; ~₹0.01/transaction on gpt-4o-mini.
- **EAS builds:** free tier quota, or ₹0 forever with local builds (Path B).

---

## 7. Personal-assistant features (Phase 6)

The app is now more than a finance tracker. Three assistant features were added.
All of the AI runs on the backend; if it's ever unreachable the app **retries 3×
and then lets you through** — you're never locked out by an outage.

### 7.1 Classifier: Jev (TypeSafe) instead of Gemini

Transactions are now categorised by **Jev**, TypeSafe's decision model — it returns
one of your categories with a calibrated confidence in ~100–400 ms and cannot
hallucinate a category. On this account's own 120 labelled transactions Jev matched
Gemini's accuracy while being ~12× faster and far cheaper.

- Secret: `wrangler secret put TYPESAFE_API_KEY` (already set in prod).
- `wrangler.toml`: `CLASSIFIER = "jev"` (options: `jev` → Jev, LLM only on error;
  `hybrid` → also ask the LLM when Jev's confidence < 0.5; `llm` → old behaviour).
- **Fallback LLM is now Cloudflare Workers AI** (`[ai]` binding, `AI_MODEL =
  @cf/meta/llama-4-scout-17b-16e-instruct`) — text **and** vision — so the app no
  longer depends on the (now credit-exhausted) Gemini key. `LLM_*` is still tried
  first if it has credit.

### 7.2 Weekly bank-statement reconciliation

Share a bank-statement **PDF** to the app (share sheet → Finance Tracker) or
Settings → **Bank statements** → Upload. The PDF text is extracted **on the phone**
(PDFBox; password-protected statements are unlocked locally — you're prompted for
the password, only the text is uploaded). The backend matches every line against
your ledger and shows: **missing** rows to add, **ghost** rows to remove (manual/cash
entries default to *keep*), and what already matches — nothing changes until you
approve each item. Re-uploading the same statement is idempotent.

- Reminder: a local notification fires **Friday 20:00 IST**, then every 8 h until you
  upload that week's statement.

### 7.3 Daily learning check-in + Instagram guard

- **10:30 PM IST** a notification asks what you learned (topic: inference
  engineering). The check-in must be ≥15 real words and a genuine update (or an
  honest "couldn't study") — validated locally, then by Jev. After it's accepted the
  coach replies with a follow-up question.
- **Instagram guard** (Settings → *Focus & Instagram guard*) — needs three
  one-time grants:
  1. **Accessibility service** — lets the app notice Instagram opening. Settings →
     Accessibility → Finance Tracker → On.
  2. **Usage access** — for the "you've used Instagram N min today" line.
  3. **Uninstall protection** (device admin) — makes the app undeletable from the
     phone UI.
- Rules: **2 keys/day** (a key is spent when you leave Instagram); the **first open
  each day needs a photo of the folded green blanket** (camera only); after 22:30
  Instagram is **locked until the day's check-in is done**.

> The accessibility service and device-admin need a fresh APK (native code) — they
> can't ship over the air. Rebuild + reinstall (Path B in §2) after upgrading.

### 7.4 Removing the app (uninstall protection is on)

Once device-admin uninstall protection is enabled, the phone UI won't let you
uninstall. Remove it over USB:

```bash
adb shell dpm remove-active-admin com.personal.financetracker/.FocusAdminReceiver
adb uninstall com.personal.financetracker
```

### 7.5 Server migration for these features

The new tables (`learning_checkins`, `assistant_messages`, `focus_events`,
`statements`, `statement_items`) are created by the idempotent migration:

```bash
cd server && npm run db:migrate        # remote (prod)
```
