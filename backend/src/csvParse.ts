/**
 * Minimal RFC-4180 CSV reader for flashcard bulk import.
 *
 * Handles: quoted fields, embedded commas, embedded newlines, escaped quotes
 * ("" → "), CRLF line endings, and a leading UTF-8 BOM. Written by hand rather
 * than pulled from npm — the surface is small and this keeps the Worker bundle
 * dependency-free.
 *
 * Not supported (deliberately): alternate delimiters, comments, type inference.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false; // whether the current row has any content

  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM

  for (; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch; // newlines inside quotes are part of the field
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      started = true;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      started = false;
    } else if (ch === '\r') {
      // CRLF: the \n that follows ends the row. A lone \r is treated as
      // whitespace and dropped.
    } else {
      field += ch;
      started = true;
    }
  }

  // Flush the final field/row (file may not end with a newline).
  if (started || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty rows (trailing blank lines are common in exports).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface ParsedCard {
  question: string;
  options: [string, string, string, string];
  answer: number;
  difficulty: 'medium' | 'hard';
}

export interface ParseResult {
  cards: ParsedCard[];
  errors: { line: number; reason: string }[];
  headerSkipped: boolean;
}

const EXPECTED_COLS = 6; // question, opt1..opt4, answer
const OPTIONAL_COLS = 7; // + difficulty

/**
 * Parse a flashcard CSV into validated cards.
 *
 * Expected columns: question, option1, option2, option3, option4, answer[, difficulty]
 * `answer` is the 0-based index of the correct option.
 *
 * A header row is detected and skipped when the 6th column of the first row is
 * not a valid answer index (e.g. the literal "answer").
 */
export function parseFlashcardCsv(text: string): ParseResult {
  const rows = parseCsv(text);
  const cards: ParsedCard[] = [];
  const errors: { line: number; reason: string }[] = [];
  let headerSkipped = false;

  let start = 0;
  if (rows.length) {
    const first = rows[0].map((c) => c.trim());
    // A row is only a header if it actually looks like one. Testing "the 6th
    // column isn't 0-3" alone would silently swallow a malformed first data row
    // (e.g. a bad answer index), so require a header-ish keyword too.
    const sixth = first[5] ?? '';
    const headerWord = /^(question|front|term|prompt|q)$/i.test(first[0] ?? '');
    const answerWord = /^(answer|correct|ans|answer_?index)$/i.test(sixth);
    if (headerWord || answerWord) {
      headerSkipped = true;
      start = 1;
    }
  }

  for (let r = start; r < rows.length; r++) {
    const line = r + 1; // 1-based, matching what a spreadsheet shows
    const cols = rows[r].map((c) => c.trim());

    if (cols.length < EXPECTED_COLS) {
      errors.push({ line, reason: `expected ${EXPECTED_COLS} columns, got ${cols.length}` });
      continue;
    }

    const question = cols[0];
    const options = [cols[1], cols[2], cols[3], cols[4]] as [string, string, string, string];
    const answerRaw = cols[5];

    if (!question) {
      errors.push({ line, reason: 'empty question' });
      continue;
    }
    if (options.some((o) => !o)) {
      errors.push({ line, reason: 'empty option' });
      continue;
    }
    if (new Set(options).size !== 4) {
      errors.push({ line, reason: 'duplicate options' });
      continue;
    }
    if (!/^[0-3]$/.test(answerRaw)) {
      errors.push({ line, reason: `answer must be 0-3, got "${answerRaw}"` });
      continue;
    }

    const difficulty = cols[OPTIONAL_COLS - 1]?.toLowerCase() === 'hard' ? 'hard' : 'medium';

    cards.push({
      question: question.slice(0, 500),
      options,
      answer: Number(answerRaw),
      difficulty,
    });
  }

  return { cards, errors, headerSkipped };
}
