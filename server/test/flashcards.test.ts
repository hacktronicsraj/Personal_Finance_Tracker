import { describe, expect, it } from 'vitest';
import { extractShareText, shareId } from '../src/flashcards';

describe('shareId', () => {
  it('extracts the id from chatgpt/openai share links, ignoring query', () => {
    expect(shareId('https://chatgpt.com/share/6ab2a7e8-fda8-83e8-90b0-b754b9806c5d?ogimg=plain')).toBe('6ab2a7e8-fda8-83e8-90b0-b754b9806c5d');
    expect(shareId('https://chat.openai.com/share/abcdef0123456789')).toBe('abcdef0123456789');
    expect(shareId('https://example.com/foo')).toBeNull();
  });
});

describe('extractShareText', () => {
  it('pulls natural-language strings from the turbo-stream and drops boilerplate', () => {
    const convo = 'A token ID like cat maps to an integer that indexes into the embedding table.';
    const boiler = 'Someone shared part of their work with you and you can view it here now.';
    const html = `<html><script>window.__reactRouterContext.streamController.enqueue("[\\"role\\",\\"assistant\\",\\"${convo}\\",\\"${boiler}\\",\\"short\\"]")</script></html>`;
    const text = extractShareText(html);
    expect(text).toContain('embedding table');
    expect(text).not.toContain('shared part of their work');
  });
});
