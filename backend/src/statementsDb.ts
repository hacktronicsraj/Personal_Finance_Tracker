import { ruleClassify } from './classify';
import { deleteTransaction, insertTransaction, now, uid } from './db';
import type { ParsedStatement, Reconciliation } from './statements';
import { statementDedupeKey } from './statements';
import type { Env, ParsedTxn } from './types';

export interface StatementSummary {
  id: string;
  bank: string | null;
  account_tail: string | null;
  period_start: string;
  period_end: string;
  parser: string;
  row_count: number;
  credits_ignored: number;
  status: string;
  created_at: string;
}

export interface StatementItem {
  id: string;
  statement_id: string;
  kind: string; // add | remove | match
  idx: number | null;
  date: string | null;
  description: string | null;
  merchant: string | null;
  amount: number | null;
  type: string | null;
  ref: string | null;
  txn_id: string | null;
  dedupe_key: string | null;
  note: string | null;
  suggested: string | null;
  decision: string;
  created_at: string;
}

/** Persist a parsed statement + its reconciliation proposals. */
export async function createStatement(
  env: Env,
  parsed: ParsedStatement,
  recon: Reconciliation,
): Promise<string> {
  const id = uid();
  const ts = now();
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    env.DB.prepare(
      `INSERT INTO statements (id, bank, account_tail, period_start, period_end, parser, row_count, credits_ignored, status, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'pending', ?)`,
    ).bind(id, parsed.bank, parsed.accountTail, parsed.periodStart, parsed.periodEnd, parsed.parser, parsed.rows.length, recon.creditsIgnored, ts),
  );

  const addItem = (
    kind: string,
    fields: Partial<StatementItem> & { suggested?: string; decision?: string },
  ) => {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO statement_items
          (id, statement_id, kind, idx, date, description, merchant, amount, type, ref, txn_id, dedupe_key, note, suggested, decision, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        uid(), id, kind, fields.idx ?? null, fields.date ?? null, fields.description ?? null, fields.merchant ?? null,
        fields.amount ?? null, fields.type ?? null, fields.ref ?? null, fields.txn_id ?? null, fields.dedupe_key ?? null,
        fields.note ?? null, fields.suggested ?? null, fields.decision ?? 'pending', ts,
      ),
    );
  };

  for (const r of recon.adds) {
    addItem('add', {
      idx: r.idx, date: r.date, description: r.description, merchant: r.merchant, amount: r.amount, type: r.type, ref: r.ref,
      dedupe_key: statementDedupeKey(parsed.accountTail, r), suggested: 'approve',
    });
  }
  for (const rm of recon.removes) {
    addItem('remove', {
      txn_id: rm.txn.id, amount: rm.txn.amount, date: (rm.txn.occurred_at ?? rm.txn.created_at).slice(0, 10),
      merchant: rm.txn.merchant, description: rm.txn.raw_text, note: rm.note, suggested: rm.suggested,
    });
  }
  for (const m of recon.matches) {
    addItem('match', { idx: m.row.idx, date: m.row.date, merchant: m.row.merchant, amount: m.row.amount, txn_id: m.txn.id, decision: 'done' });
  }

  // D1 batches cap around 100 statements; chunk to be safe.
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return id;
}

export async function getStatement(env: Env, id: string): Promise<{ statement: StatementSummary; items: StatementItem[] } | null> {
  const statement = await env.DB.prepare('SELECT * FROM statements WHERE id = ?').bind(id).first<StatementSummary>();
  if (!statement) return null;
  const items = await env.DB.prepare('SELECT * FROM statement_items WHERE statement_id = ? ORDER BY kind, idx').bind(id).all<StatementItem>();
  return { statement, items: items.results ?? [] };
}

export async function listStatements(env: Env): Promise<StatementSummary[]> {
  const res = await env.DB.prepare('SELECT * FROM statements ORDER BY created_at DESC LIMIT 50').all<StatementSummary>();
  return res.results ?? [];
}

/**
 * Apply approved proposals. `decisions` maps an item id to 'approve'|'deny';
 * anything omitted falls back to the item's stored suggestion. Resumable: items
 * already 'done' are skipped, adds de-dupe, so re-running finishes a partial apply.
 */
export async function applyStatement(
  env: Env,
  id: string,
  decisions: Record<string, 'approve' | 'deny'>,
): Promise<{ added: number; removed: number }> {
  const loaded = await getStatement(env, id);
  if (!loaded) throw new Error('statement not found');
  let added = 0;
  let removed = 0;

  for (const item of loaded.items) {
    if (item.decision === 'done') continue;
    const decision = decisions[item.id] ?? item.suggested ?? 'deny';
    if (item.kind === 'add' && decision === 'approve') {
      const parsed: ParsedTxn = {
        amount: item.amount ?? 0,
        direction: 'debit',
        currency: 'INR',
        merchant: item.merchant,
        occurredAt: item.date ? `${item.date}T00:00:00.000Z` : null,
        rawText: item.description ?? `Statement: ${item.merchant ?? ''} ${item.amount ?? ''}`,
      };
      const cls = ruleClassify(parsed);
      await insertTransaction(env, parsed, cls, { dedupeKey: item.dedupe_key ?? undefined, source: 'statement' });
      added++;
    } else if (item.kind === 'remove' && decision === 'approve' && item.txn_id) {
      await deleteTransaction(env, item.txn_id);
      removed++;
    }
    await env.DB.prepare('UPDATE statement_items SET decision = ? WHERE id = ?').bind(decision === 'approve' ? 'done' : 'deny', item.id).run();
  }

  await env.DB.prepare("UPDATE statements SET status = 'applied' WHERE id = ?").bind(id).run();
  return { added, removed };
}
