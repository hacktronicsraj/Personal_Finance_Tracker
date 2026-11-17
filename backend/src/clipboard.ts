import { Hono } from 'hono';
import type { Env } from './types';

/**
 * Shared clipboard between the Mac and the Android app.
 *
 * Text items live in D1; images and files live in the R2 bucket and are
 * proxied through here, so nothing is ever public. Same API as the old `pft`
 * Worker, so Dr Watson (the Mac side) talks to either unchanged.
 *
 * Every item is scoped to an `owner` (header `x-clipboard-owner`). There is
 * one user, so both devices use the default owner `drwatson`.
 */

interface ClipboardRow {
  id: string;
  owner: string;
  device_id: string;
  device_name: string | null;
  kind: 'text' | 'image' | 'file';
  text: string | null;
  blob_key: string | null;
  mime: string | null;
  file_name: string | null;
  byte_size: number | null;
  created_at: string;
  deleted_at: string | null;
}

const MAX_TEXT_CHARS = 200_000;
const MAX_BLOB_BYTES = 64 * 1024 * 1024;
const RETENTION_DAYS = 7;

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

function ownerOf(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header('x-clipboard-owner') || 'drwatson';
}

/** Images and files need the R2 bucket; text works without it. */
function bucket(env: Env): R2Bucket {
  if (!env.CLIPBOARD) throw new Error('CLIPBOARD bucket not bound');
  return env.CLIPBOARD;
}

export function registerClipboardRoutes(app: Hono<{ Bindings: Env }>) {
  // Push an item. Text arrives as JSON; images and files as raw bytes with
  // their metadata in headers, so a large upload never gets base64-inflated.
  app.post('/clipboard', async (c) => {
    const owner = ownerOf(c);
    const type = c.req.header('content-type') ?? '';
    if (type.includes('application/json')) {
      const body = (await c.req.json()) as {
        text?: string;
        deviceId?: string;
        deviceName?: string;
      };
      const text = (body.text ?? '').trim();
      if (!text) return c.json({ error: 'empty text' }, 400);
      if (text.length > MAX_TEXT_CHARS) return c.json({ error: 'text too large' }, 413);
      // The same text again (an echo from the other side, or the phone
      // re-sending its clipboard on every open) is not a new item.
      const latest = await c.env.DB.prepare(
        `SELECT id, text, created_at FROM clipboard_items
         WHERE owner = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(owner)
        .first<{ id: string; text: string | null; created_at: string }>();
      if (latest?.text === text) return c.json({ id: latest.id, createdAt: latest.created_at, duplicate: true });
      const id = uid();
      const created = now();
      await c.env.DB.prepare(
        `INSERT INTO clipboard_items (id, owner, device_id, device_name, kind, text, created_at)
         VALUES (?, ?, ?, ?, 'text', ?, ?)`,
      )
        .bind(id, owner, body.deviceId ?? 'unknown', body.deviceName ?? null, text, created)
        .run();
      await prune(c.env, owner);
      return c.json({ id, createdAt: created });
    }

    if (!c.env.CLIPBOARD) return c.json({ error: 'images and files are not enabled' }, 501);
    const kind = c.req.header('x-clipboard-kind') === 'image' ? 'image' : 'file';
    const bytes = await c.req.arrayBuffer();
    if (!bytes.byteLength) return c.json({ error: 'empty body' }, 400);
    if (bytes.byteLength > MAX_BLOB_BYTES) return c.json({ error: 'too large' }, 413);
    const id = uid();
    const created = now();
    const blobKey = `clipboard/${owner}/${id}`;
    const mime = c.req.header('x-clipboard-mime') ?? 'application/octet-stream';
    const fileName = c.req.header('x-clipboard-name') ?? (kind === 'image' ? 'image.png' : 'file');
    await bucket(c.env).put(blobKey, bytes, { httpMetadata: { contentType: mime } });
    await c.env.DB.prepare(
      `INSERT INTO clipboard_items (id, owner, device_id, device_name, kind, blob_key, mime, file_name, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, owner, c.req.header('x-clipboard-device') ?? 'unknown', c.req.header('x-clipboard-device-name') ?? null,
        kind, blobKey, mime, fileName, bytes.byteLength, created)
      .run();
    await prune(c.env, owner);
    return c.json({ id, createdAt: created, kind });
  });

  // Everything new since a timestamp, newest first. Deleted items are listed
  // with `deleted: true` so the other side can remove them too.
  app.get('/clipboard', async (c) => {
    const owner = ownerOf(c);
    const since = c.req.query('since') ?? '';
    const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 200);
    const rows = await c.env.DB.prepare(
      `SELECT * FROM clipboard_items
       WHERE owner = ? AND created_at > ?
       ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(owner, since, limit)
      .all<ClipboardRow>();
    return c.json({ items: (rows.results ?? []).map(publicItem), serverTime: now() });
  });

  app.get('/clipboard/:id/blob', async (c) => {
    const owner = ownerOf(c);
    const row = await c.env.DB.prepare('SELECT * FROM clipboard_items WHERE id = ? AND owner = ?')
      .bind(c.req.param('id'), owner)
      .first<ClipboardRow>();
    if (!row?.blob_key) return c.json({ error: 'not found' }, 404);
    const object = await bucket(c.env).get(row.blob_key);
    if (!object) return c.json({ error: 'gone' }, 404);
    return new Response(object.body, {
      headers: {
        'content-type': row.mime ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${(row.file_name ?? 'file').replace(/"/g, '')}"`,
      },
    });
  });

  app.delete('/clipboard/:id', async (c) => {
    const owner = ownerOf(c);
    const row = await c.env.DB.prepare('SELECT * FROM clipboard_items WHERE id = ? AND owner = ?')
      .bind(c.req.param('id'), owner)
      .first<ClipboardRow>();
    if (!row) return c.json({ error: 'not found' }, 404);
    await c.env.DB.prepare('UPDATE clipboard_items SET deleted_at = ?, text = NULL WHERE id = ?')
      .bind(now(), row.id)
      .run();
    if (row.blob_key) await bucket(c.env).delete(row.blob_key);
    return c.json({ ok: true });
  });
}

function publicItem(row: ClipboardRow) {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    deviceId: row.device_id,
    deviceName: row.device_name,
    mime: row.mime,
    fileName: row.file_name,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    deleted: row.deleted_at != null,
  };
}

/** Drops text older than the retention window, and the blobs of any item
 *  whose row went with it. */
async function prune(env: Env, owner: string) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const old = await env.DB.prepare(
    'SELECT id, blob_key FROM clipboard_items WHERE owner = ? AND created_at < ? LIMIT 50',
  )
    .bind(owner, cutoff)
    .all<{ id: string; blob_key: string | null }>();
  for (const row of old.results ?? []) {
    if (row.blob_key) await bucket(env).delete(row.blob_key);
  }
  await env.DB.prepare('DELETE FROM clipboard_items WHERE owner = ? AND created_at < ?')
    .bind(owner, cutoff)
    .run();
}
