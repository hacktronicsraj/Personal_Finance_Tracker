# Feature Plan — Phase 5

Eight features, phased into 8 milestones. Ordered so the highest daily-use value ships first
and all native-dependency churn is isolated into a single risky prebuild (M4).

Conventions used throughout:
- **D1 migrations**: `schema.sql` (`CREATE TABLE IF NOT EXISTS` + inline columns) only
  provisions a *fresh* DB — it can't add columns to the existing remote table, since D1's
  `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS`. Column additions go through
  `server/scripts/migrate.sh` (`npm run db:migrate`), which guards each `ALTER` with a
  `pragma_table_info` check and is safe to re-run. (Correction from the original plan: there
  was no server-side "existing `user_note` guarded-ALTER pattern" — `user_note` had been
  hand-ALTERed out-of-band; migrate.sh is now the reproducible path.)
- **Local SQLite**: mirror schema changes in `mobile/src/db/database.ts` — guarded
  `PRAGMA table_info` ALTERs + a `user_version` bump.
- **Auth**: every new endpoint sits behind the existing bearer-token middleware.
- **Deploy**: server `npm run deploy`; mobile = local `gradlew assembleRelease` (no EAS).
  JS-only milestones don't need `expo prebuild --clean`; M4 does.

---

## F1 · Mandates (manual recurring payments) — M2

Manual-entry only for now (no auto-detection). User records every mandate/autopay they have.

**Fields (per user's spec):**
| Field | Notes |
|---|---|
| `name` | What the payment is for — "Netflix", "Rent", "NPS SIP" |
| `platform` | Where the mandate is tied: `gpay` \| `phonepe` \| `paytm` \| `bank_autopay` \| `card` \| `other` |
| `amount` | Expected charge |
| `day_of_cycle` | Mandate trigger date (1–31; day-of-week if weekly) |
| `frequency` | `monthly` (default) \| `weekly` \| `quarterly` \| `yearly` — SIPs/insurance need this |
| `category` | Default `Bills & Utilities`, pick from real category list |
| `merchant_hint` | Optional substring for auto-matching incoming txns ("NETFLIX") |
| `active`, `notes` | Toggle + free text |

**D1:** `mandates` table with the above + `created_at`/`updated_at`. Add nullable
`mandate_id` column to `transactions` (guarded ALTER, both DBs).

**API:** `GET/POST /mandates`, `PATCH/DELETE /mandates/:id`. Next-due dates computed
client-side (pure function of frequency + day_of_cycle + last matched payment; clamp
day 29–31 to month end).

**Auto-match + price-jump flag:** after `/classify` saves a debit, scan active mandates:
`merchant_hint`/name token match AND amount within ±20% AND within ±3 days of expected due
→ set `txn.mandate_id` (cycle shows "paid"). If matched amount ≠ mandate amount → surface a
price-change banner on the mandate ("charged ₹649, mandate says ₹499 — update?") with
one-tap update. No notification for v1.
> **M3 follow-up (done):** M2 originally shipped this by appending `mandate:<id>` into the
> classifier-only `notes` column. M3 added the real `mandate_id` column, moved the write to a
> `linkMandate()` helper, and `migrate.sh` backfilled any legacy `notes` links. The match
> window is now a pure, unit-tested `mandateMatches()` predicate.

**Mobile UI:**
- `app/mandates.tsx` — list grouped by frequency, paid/pending state for current cycle,
  platform icon, add/edit form. Entry points: Settings row + Home "Upcoming" card header.
- Home tab: **"Upcoming"** section — mandates due in the next 7 days (name, platform,
  amount, due date), sorted by due date.

**Tests:** next-due computation (month-end clamp, quarterly/yearly rollover), match window.

---

## F2 · Learned classification rules — M1

**D1:** `merchant_rules(id, pattern UNIQUE, category, source 'learned'|'manual', hit_count, created_at, updated_at)`.

**Normalization** (shared server util, unit-tested): uppercase → strip UPI handles, ref
numbers, `*ORDER123`-style suffixes → collapse whitespace. "Swiggy*Order-4821" → "SWIGGY".

**Classify pipeline change** (`server/src/classify.ts`): normalized-merchant rule lookup
runs **before** the LLM. Hit → category from rule, `confidence 1`, `notes 'rule:merchant'`,
`hit_count++`. Miss → existing rules→LLM flow.

**Learning loop:** on every category correction (PATCH or confirm-with-changed-category —
both already write `classification_feedback`): if the same normalized merchant has ≥2
consistent corrections to the same category, upsert a `learned` rule. If the user corrects
a rule-applied txn *away* from the rule's category, decrement trust: 2 consistent contrary
corrections flip the rule; 1 just marks it contested (no flip).

**API:** `GET/POST /rules`, `PATCH/DELETE /rules/:id`.

**Mobile UI:** Settings → "Classification rules": list (pattern, category, learned/manual
badge, hit count), add manual rule ("always classify X as Y"), edit target category, delete.

**Tests:** normalization table-driven cases; learn/flip/contest state transitions.

---

## F3 · Search & filters — M3 (with tags)

Already exists: text search box (`q`), single-category chips, server `from/to/category/q/limit`.
This extends rather than rebuilds.

**Server:** `listTxns` gains `minAmount`, `maxAmount`, `source`, `tag` params.

**Mobile (`app/(tabs)/transactions.tsx`):**
- Filter button → bottom sheet: date presets (This month / Last month / 90 days / custom),
  amount min–max, source (SMS / Shared / Manual), tag picker, multi-category.
- Active-filter chips row with per-chip clear + "Clear all".
- Fix the offline fallback: cached path currently ignores `q` and all new filters — apply
  the same predicate set against the local SQLite cache so offline behaves identically.
> **M3 shipped.** Bottom sheet uses core RN `Modal` (no native dep — keeps M3 JS-only).
> Offline parity is a pure `filterTxns()` in `mobile/src/txns.ts`, unit-tested against the
> server's SQL filter matrix. **Deferred:** the "custom" date range needs a native date
> picker (`@react-native-community/datetimepicker`) → folded into the M4 native batch; M3
> ships This month / Last month / Last 90 days / All time. Source filtering required caching
> `source` in the local SQLite mirror (it wasn't before).

---

## F4 · Weekly digest + HTML report — M7

**Worker cron:** `[triggers] crons = ["30 14 * * 0"]` (Sun 14:30 UTC = 20:00 IST) +
`scheduled` handler in `index.ts`.

**Generation:** compute Mon–Sun IST window → pull summary + txns + week-over-week deltas →
call LLM with **`LLM_REPORT_MODEL`** (new var, default `gemini-2.5-pro` — strongest free-tier
Gemini; provider-agnostic override like the others; falls back to `LLM_MODEL` if unset).
The LLM returns **structured JSON** (headline, insights[], anomalies[], narrative) — the
Worker renders it into a self-contained HTML template using the Ink design tokens (dark bg,
emerald accent, embedded donut/bars as inline SVG). LLM never emits raw HTML (consistency +
injection safety; all strings escaped). One call/week keeps free-tier limits irrelevant.

**D1:** `reports(id, period_start, period_end, summary_json, html, created_at)`.

**API:** `GET /reports` (meta list), `GET /reports/latest`, `GET /reports/:id` (HTML).

**Mobile:**
- "Reports" screen: list of weeks → detail renders HTML in `react-native-webview`
  (native dep, added in M4). Cache latest HTML locally for offline viewing.
- **Notification:** repeating weekly *local* notification (Sun 20:15 IST, new `reports`
  channel): "Your weekly spending report is ready 📊" → tap deep-links to latest report.
  Chosen over background-fetch polling: zero background work (respects the Phase 4
  no-background-scanning decision), zero battery, and the cron generates server-side
  regardless. Trade-off: the notification fires even if generation failed/offline — the
  report screen handles that with a retry state.

---

## F5 · CSV export — M5

**Server:** `GET /export?from=&to=` → `text/csv` attachment. Columns: date, amount,
direction, merchant, category, tags, source, bank, account_tail, ref_no, user_note.
Proper CSV escaping (quotes, commas, newlines — unit test). Excel opens CSV natively;
XLSX (SheetJS in Worker) is a later nice-to-have, not v1.

**Mobile:** Settings → "Export data" → month/range picker → download via `expo-file-system`
to cache dir → Android share sheet via `expo-sharing` (dep from M4). Doubles as backup.

---

## F6 · App lock — M5

**Deps:** `expo-local-authentication` (M4); `expo-secure-store` already installed.

- Settings toggle "App lock" — enabling requires one successful biometric auth.
  Optional 4-digit PIN fallback stored in SecureStore (for devices w/o biometrics enrolled).
- Gate in root `_layout.tsx`: full-screen lock overlay on cold start and when returning
  from background after >60s (AppState listener; threshold constant).
- **Share-intent interplay (critical):** the lock overlay must not disturb the
  cold-start reparenting dance — `shareStore` already stashes the payload at module level,
  so: stash happens regardless of lock; unlock → normal flush to `/add`. Test shared-image
  cold start with lock enabled explicitly.
- Notification quick-action category buttons don't open the app → unaffected by lock.

---

## F7 · Tags + attachments — M3 (tags) / M6 (attachments)

### Tags
**Storage:** `tags TEXT` JSON-array column on `transactions` (guarded ALTER, both DBs) —
rides the existing row-based `/sync` for free (a join table wouldn't).

**API:** `PATCH /transactions/:id` accepts `tags: string[]`; `GET /transactions?tag=`;
`GET /analytics/tags?from=&to=` → per-tag totals (D1 `json_each`).

**Mobile:**
- Tag chip editor on transaction detail + add screen — autocomplete from existing tags,
  create-on-type. Optional field, default empty.
- Insights: "Tags" card — per-tag totals for the selected month + an all-time toggle
  (trips span months).
- Tag filter wired into the F3 filter sheet.

### Attachments (receipts — reimbursement use case; optional on any txn)
**Storage:** Cloudflare **R2** — bucket `pft-attachments`, binding `ATTACHMENTS`
(`wrangler r2 bucket create pft-attachments`; free tier 10 GB). Bucket stays private;
all access proxied through the authed Worker.

**D1:** `attachments(id, txn_id, r2_key, mime, size, created_at)`.

**API:** `POST /transactions/:id/attachments` (base64 + mime, like `/extract-image`;
key `txn/<txnId>/<attId>`), `GET /transactions/:id/attachments` (meta list),
`GET /attachments/:id` (streams from R2), `DELETE /attachments/:id`.

**Mobile:** detail screen "Attachments" section — add from camera/gallery
(`expo-image-picker`) or file/PDF (`expo-document-picker`), both from M4. Images
compressed via existing `expo-image-manipulator` before upload. Thumbnails via
authed fetch (RN `Image` with headers). Also attachable at add-time in `add.tsx`.
v1 requires connectivity for upload (clear error + retry button); outbox-queued
uploads are a later enhancement. Delete txn → cascade-delete its attachments (R2 + D1).

---

## F8 · Home-screen widget — M8

No budgets feature planned, so widget shows: **this-month spend**, **next upcoming
mandate** (name + ₹ + date), last-updated stamp. Ink-dark styling.

**Native (config plugin `mobile/plugins/withSpendWidget.js`** — same pattern as
`withSmsReceiver.js`; plugin owns ALL native code so clean prebuilds are safe):
- Kotlin `SpendWidgetProvider` (AppWidgetProvider + RemoteViews XML layout).
- Tiny bridge module: JS writes a `widget_data` JSON blob (month total, next mandate,
  updated_at) to SharedPreferences + broadcasts widget refresh.

**Data freshness (event-driven, no polling):** JS updates SharedPreferences whenever
(a) app foregrounds/syncs, and (b) the **headless SMS ingest task** completes — every debit
SMS already wakes JS in the background, so the widget stays fresh without any scheduled
work. A native WorkManager fetch is explicitly *not* needed v1.

**Skeleton (plugin + deps) lands in M4's clean prebuild; the full widget ships in M8.**

---

## Cross-cutting

### M4 — the single native batch (one clean prebuild + APK)
Add together, verify together: `expo-local-authentication`, `expo-image-picker`,
`expo-document-picker`, `expo-sharing`, `react-native-webview`, `withSpendWidget` plugin
skeleton. All are old-architecture compatible (`newArchEnabled: false` stays).
**Post-build regression checklist** (the things clean prebuilds have broken before):
SMS receiver + headless ingest on a real debit SMS; share-intent cold start (text +
GPay screenshot); notification quick actions; launcher/notification icons; Restricted
Settings still granted.

### Cloudflare changes
- R2 bucket + binding (M6), cron trigger (M7), `LLM_REPORT_MODEL` var (M7).
- `schema.sql` grows in M1 (rules), M2 (mandates + txn.mandate_id), M3 (txn.tags),
  M6 (attachments), M7 (reports) — each `npm run db:init:remote` is idempotent.

### Milestones & order
| # | Ships | Type | Status | Why this order |
|---|---|---|---|---|
| M1 | Rules engine + Settings editor | JS + server | ✅ shipped | Cleans up data quality for everything after; zero native risk |
| M2 | Mandates + Upcoming section | JS + server | ✅ shipped | Highest new user value |
| M3 | Filter sheet + tags + tag analytics | JS + server | ✅ shipped (custom-date preset → M4) | List UX before history grows |
| M4 | Native dep batch + widget plugin skeleton | native, clean prebuild | ✅ shipped | Isolates the one risky build |
| M5 | App lock + CSV export | JS (uses M4 deps) | ✅ shipped | Small, independent wins |
| M6 | Attachments (R2 + UI) | server + JS | ✅ shipped | Needs M4 pickers |
| M7 | Weekly digest + reports screen + notification | server-heavy | ✅ shipped | Needs M4 webview |
| M8 | Home-screen widget | native/Kotlin | ✅ shipped | Riskiest; everything else already shipped |

All 8 milestones are code-complete and verified (server 37 tests, mobile 42 tests; a full
debug APK builds cleanly through the M4 and M8 native additions).

**Post-plan additions (2026-07-17, on-device testing session):**
- **Monthly reports** (extends F4): `monthWindowIST`, `generateReport(type, offset)` with
  past-month backfill, `reports.period_type` column, second cron `30 18 L * *` (00:00 IST on
  the 1st, covers the just-ended month), month-picker chips + type badges in the app.
  Regenerating a period replaces its old row (no duplicates).
- **Manual-add dedupe bug fixed** (found on-device): manual/shared saves salt the dedupe key
  (`ingest.ts`) — an unsalted key made every same-amount manual add collide forever; and
  `source='manual'` is exempt from the 15-min cross-channel fuzzy merge (`index.ts`).
- **UI polish pass** via the `ui-ux-pro-max` skill audit: SVG icon system (no emoji/glyph
  controls), android_ripple + pressed states everywhere, ≥48dp touch targets, accessibility
  roles/labels/states, actionable empty states.
- **In-app confirm dialog** (`components/ConfirmDialog.tsx`) replaces the native `Alert` for
  all destructive actions (delete transaction / mandate / attachment) so the confirm step
  stays in the Ink design language instead of the white Material dialog.
- **Mandate due-date** now shows the concrete calendar date ("Due 15 Aug", "In 3 days · 20
  Jul"); weekly mandates show the weekday ("Every Monday") instead of a bare day number.
- Worker deployed to production; on-device flows verified on a Pixel 9 via adb (see repo
  history for the session's screenshots).

**Infra done (additive, safe):** remote D1 migrated (`tags`/`mandate_id`, legacy backfill);
`attachments` + `reports` tables created; R2 bucket `pft-attachments` created + bound; cron
trigger + `LLM_REPORT_MODEL` in `wrangler.toml`.

**Still gated on the user (outward-facing):** `npm run deploy` (Worker — publishes the new
routes + cron), and `gradlew assembleRelease` → sideload (APK). Device-only checks that can't
run from CI: biometric prompt, widget on the home screen, share-intent cold start with lock on,
notification quick actions. See the M4 post-build regression checklist below.

Each milestone is independently shippable: deploy Worker → rebuild APK → sideload.

### Known gotchas to respect (from prior phases)
- `resetOnBackground: false` on expo-share-intent; shareStore stash pattern must survive the lock screen.
- `rawText` stays optional on `/classify`.
- Notification icons must be monochrome; new `reports` channel reuses existing icon.
- Cron schedules are UTC; IST is fixed +5:30 (no DST) so a constant works.
- D1 `ALTER TABLE ADD COLUMN` isn't `IF NOT EXISTS` — use `npm run db:migrate`
  (`server/scripts/migrate.sh`), which guards each ALTER with a `pragma_table_info` check.
