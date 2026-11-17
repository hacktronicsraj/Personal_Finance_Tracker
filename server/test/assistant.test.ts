import { describe, expect, it } from 'vitest';
import { countWords, localCheckinVerdict, similarity, validateCheckin } from '../src/assistant';
import { addDays, dayDiff, isDay, istDay, istDayOfIso, istMidnightUtc } from '../src/ist';
import { choiceConfidence, jevDecide } from '../src/jev';
import type { Env } from '../src/types';

const GOOD =
  'Today I read about KV cache paging in vLLM and why continuous batching improves GPU utilisation. I also benchmarked a small model with different batch sizes.';
const SKIPPED =
  'I could not study today because I had a family function all evening and got home late, so I will make up for it tomorrow morning.';

describe('countWords', () => {
  it('counts words with letters only', () => {
    expect(countWords('hello world 123 !!! vLLM-v2')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});

describe('localCheckinVerdict', () => {
  it('accepts real updates and honest skip reasons', () => {
    expect(localCheckinVerdict(GOOD).ok).toBe(true);
    expect(localCheckinVerdict(SKIPPED).ok).toBe(true);
  });
  it('enforces the 15-word minimum', () => {
    const v = localCheckinVerdict('Learned about attention today, it was good.');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/15 words/);
  });
  it('rejects padding with one repeated word', () => {
    expect(localCheckinVerdict('learning '.repeat(20)).ok).toBe(false);
  });
  it('rejects keyboard mashing', () => {
    expect(localCheckinVerdict('asdf qwrt zxcv bnmm lkjh ghjk sdfg wert xcvb dfgh cvbn rtyu fghj vbnm tyui').ok).toBe(false);
  });
  it('rejects a copy of an earlier check-in', () => {
    expect(localCheckinVerdict(GOOD, [GOOD.replace('small', 'tiny')]).ok).toBe(false);
  });
  it('similarity is symmetric and bounded', () => {
    expect(similarity(GOOD, GOOD)).toBe(1);
    expect(similarity(GOOD, SKIPPED)).toBeLessThan(0.3);
  });
});

describe('validateCheckin fallbacks', () => {
  const offline: Env = { LLM_MODE: 'live' } as Env; // no Jev key, no LLM, no Workers AI
  it('fails open (accepts) when no model is reachable but local rules pass', async () => {
    const v = await validateCheckin(offline, { text: GOOD, topic: 'inference engineering', recent: [] });
    expect(v).toMatchObject({ accepted: true, source: 'fail-open' });
  });
  it('still enforces local rules when every model is down', async () => {
    const v = await validateCheckin(offline, { text: 'short', topic: 'x', recent: [] });
    expect(v).toMatchObject({ accepted: false, source: 'local' });
  });
});

describe('ist helpers', () => {
  it('rolls the IST day at 18:30 UTC', () => {
    expect(istDay(Date.parse('2026-09-21T18:29:59Z'))).toBe('2026-09-21');
    expect(istDay(Date.parse('2026-09-21T18:30:00Z'))).toBe('2026-09-22');
    expect(istDayOfIso('2026-09-21T20:00:00.000Z')).toBe('2026-09-22');
    expect(istDayOfIso('2026-09-21')).toBe('2026-09-21');
  });
  it('day arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(dayDiff('2026-09-01', '2026-09-03')).toBe(2);
    expect(new Date(istMidnightUtc('2026-09-22')).toISOString()).toBe('2026-09-21T18:30:00.000Z');
    expect(isDay('2026-09-22')).toBe(true);
    expect(isDay('2026-9-22')).toBe(false);
  });
});

describe('jevDecide', () => {
  const env = { TYPESAFE_API_KEY: 'k' } as Env;
  const ok = (answers: unknown) => new Response(JSON.stringify({ answers }), { status: 200 });

  it('retries transient 529/429 then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls < 3 ? new Response('busy', { status: calls === 1 ? 529 : 429 }) : ok({ q: { type: 'noul', noul: 0.9 } });
    }) as unknown as typeof fetch;
    const a = await jevDecide(env, 's', { q: { type: 'noul', instructions: 'x' } }, { fetchImpl, retries: 3 });
    expect(a.q.noul).toBe(0.9);
    expect(calls).toBe(3);
  });

  it('gives up after 1 + retries attempts', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response('x', { status: 503 }); }) as unknown as typeof fetch;
    await expect(jevDecide(env, 's', { q: { type: 'noul', instructions: 'x' } }, { fetchImpl, retries: 3 })).rejects.toThrow();
    expect(calls).toBe(4);
  });

  it('does not retry a bad key', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response('nope', { status: 401 }); }) as unknown as typeof fetch;
    await expect(jevDecide(env, 's', { q: { type: 'noul', instructions: 'x' } }, { fetchImpl })).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  it('choiceConfidence falls back to the chosen probability', () => {
    expect(choiceConfidence({ type: 'choice', choice: 'A', probabilities: { A: 0.7, B: 0.3 } })).toBe(0.7);
    expect(choiceConfidence({ type: 'choice', choice: 'A', confidence: 0.9 })).toBe(0.9);
    expect(choiceConfidence(undefined)).toBe(0);
  });
});

describe('verifyBlanket', () => {
  it('fails open after the vision model keeps failing', async () => {
    const { verifyBlanket } = await import('../src/assistant');
    let calls = 0;
    const env = { LLM_MODE: 'live', AI: { run: async () => { calls++; throw new Error('down'); } } } as unknown as Env;
    const v = await verifyBlanket(env, 'AAAA');
    expect(v).toMatchObject({ verified: true, failOpen: true });
    expect(calls).toBe(4); // 1 try + 3 retries
  }, 20000);

  it('needs green AND folded', async () => {
    const { verifyBlanket } = await import('../src/assistant');
    const mk = (r: object) => ({ LLM_MODE: 'live', AI: { run: async () => ({ response: r }) } }) as unknown as Env;
    expect((await verifyBlanket(mk({ blanket_visible: true, is_green: true, fold_state: 'folded', is_real_scene: true }), 'A')).verified).toBe(true);
    expect((await verifyBlanket(mk({ blanket_visible: true, is_green: true, fold_state: 'spread', is_real_scene: true }), 'A')).verified).toBe(false);
    expect((await verifyBlanket(mk({ blanket_visible: true, is_green: false, fold_state: 'folded', is_real_scene: true }), 'A')).verified).toBe(false);
    expect((await verifyBlanket(mk({ blanket_visible: true, is_green: true, fold_state: 'folded', is_real_scene: false }), 'A')).verified).toBe(false);
  });
});
