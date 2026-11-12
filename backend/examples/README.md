# Uploading flashcards

## Where

`POST /flashcards/bulk` on the native Worker:

```
https://pft-native.thunderstorm0122.workers.dev/flashcards/bulk
```

Requires the `Authorization: Bearer <API_TOKEN>` header (same token the app uses).

## Format

CSV with a header row. Columns:

```
question,option1,option2,option3,option4,answer,difficulty
```

| Column | Required | Notes |
|---|---|---|
| `question` | yes | Max 500 chars |
| `option1`–`option4` | yes | All four must be distinct |
| `answer` | yes | **0-based** index of the correct option (0, 1, 2, or 3) |
| `difficulty` | no | `medium` (default) or `hard` |

`answer` is **0-based**: `0` = `option1`, `1` = `option2`, `3` = `option4`.

Quote any field containing a comma, a quote, or a newline. Inside quotes, write a
literal `"` as `""`. See `flashcards.sample.csv`.

## Example

```bash
curl -X POST https://pft-native.thunderstorm0122.workers.dev/flashcards/bulk \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'content-type: application/json' \
  -d "$(python3 -c 'import json;print(json.dumps({"csv":open("flashcards.sample.csv").read(),"deck":"inference"}))')"
```

Or from the app once the Library screen ships.

## Request body

```json
{ "csv": "<file contents>", "deck": "inference", "source": "anki-export-1" }
```

- `deck` — which deck the cards join. Defaults to `default`.
- `source` — a label recorded on each card. Defaults to `csv:<deck>`.

## Response

```json
{
  "added": 3,
  "skipped": 0,
  "deck": "inference",
  "parsed": 3,
  "errors": [],
  "headerSkipped": true,
  "total": 6
}
```

- `added` — cards inserted.
- `skipped` — duplicates. **Dedupe is global, not per deck**: the same question
  can't exist in two decks, so one checkpoint can't grade it twice.
- `errors` — per-row problems with 1-based line numbers matching a spreadsheet.
  Bad rows don't fail the file; the good ones still import.

## Notes

- Re-importing the same file is safe — it reports `added: 0, skipped: N`.
- Max body ~2 MB.
- Cards land immediately in the gate's rotation (`last_shown_at` starts NULL, so
  new cards are preferred over recently-shown ones).
- To pull a card out of rotation without deleting it: `PATCH /flashcards/:id`
  with `{"suspended": true}`.
