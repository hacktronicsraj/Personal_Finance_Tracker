import { describe, expect, it } from 'vitest';
import { hashCard } from '../src/assistantDb';

/**
 * hashCard is the bulk-import dedupe key. It has no runtime dependency on D1, so
 * it's tested directly. The selection/spacing queries are exercised against a
 * real D1 in `npm run db:init && npm test` — see flashcards.test.ts notes.
 */
describe('hashCard', () => {
  it('is stable for identical cards', () => {
    const a = hashCard('What is KV cache?', ['A', 'B', 'C', 'D']);
    const b = hashCard('What is KV cache?', ['A', 'B', 'C', 'D']);
    expect(a).toBe(b);
  });

  it('differs when the question changes', () => {
    expect(hashCard('Q1', ['A', 'B', 'C', 'D'])).not.toBe(hashCard('Q2', ['A', 'B', 'C', 'D']));
  });

  it('differs when the options change', () => {
    expect(hashCard('Q', ['A', 'B', 'C', 'D'])).not.toBe(hashCard('Q', ['A', 'B', 'C', 'E']));
  });

  it('differs on option order', () => {
    // Order matters: the same options shuffled is a different card to the user.
    expect(hashCard('Q', ['A', 'B', 'C', 'D'])).not.toBe(hashCard('Q', ['B', 'A', 'C', 'D']));
  });

  it('accepts a pre-serialized options string (DB rows)', () => {
    const opts = ['A', 'B', 'C', 'D'];
    expect(hashCard('Q', JSON.stringify(opts))).toBe(hashCard('Q', opts));
  });

  it('is 8 lowercase hex chars', () => {
    expect(hashCard('anything', ['1', '2', '3', '4'])).toMatch(/^[0-9a-f]{8}$/);
  });
});
