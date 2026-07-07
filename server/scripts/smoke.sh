#!/usr/bin/env bash
# End-to-end smoke test against a running `npm run dev` (http://localhost:8787).
set -euo pipefail
BASE="${BASE:-http://localhost:8787}"
AUTH=()
if [[ -n "${API_TOKEN:-}" ]]; then AUTH=(-H "authorization: Bearer ${API_TOKEN}"); fi

say() { printf '\n=== %s ===\n' "$1"; }

say "health"
curl -sf "${BASE}/health"; echo

say "classify (IDBI Groww debit)"
curl -sf ${AUTH[@]+"${AUTH[@]}"} -X POST "${BASE}/classify" -H 'content-type: application/json' -d '{
  "deviceId":"smoke",
  "rawText":"IDBI Bank Acct XX417 debited for Rs 9000.00 on 02-Jul-26; Bal Rs 432.58 Groww Invest Te credited. UPI:618359694589.",
  "parsed":{"amount":9000,"direction":"debit","merchant":"Groww Invest Te","accountTail":"417","refNo":"618359694589","balance":432.58,"occurredAt":"2026-07-02T00:00:00.000Z","bank":"IDBI Bank"}
}'; echo

say "classify (Swiggy debit)"
curl -sf ${AUTH[@]+"${AUTH[@]}"} -X POST "${BASE}/classify" -H 'content-type: application/json' -d '{
  "deviceId":"smoke",
  "rawText":"IDBI Bank Acct XX417 debited for Rs 350.00 on 02-Jul-26; Bal Rs 82.58 SWIGGY credited. UPI:111.",
  "parsed":{"amount":350,"direction":"debit","merchant":"SWIGGY","accountTail":"417","refNo":"111","occurredAt":"2026-07-02T00:00:00.000Z"}
}'; echo

say "transactions"
curl -sf ${AUTH[@]+"${AUTH[@]}"} "${BASE}/transactions" | head -c 800; echo

say "analytics/summary"
curl -sf ${AUTH[@]+"${AUTH[@]}"} "${BASE}/analytics/summary"; echo

say "categories"
curl -sf ${AUTH[@]+"${AUTH[@]}"} "${BASE}/categories" | head -c 400; echo

printf '\nOK\n'
