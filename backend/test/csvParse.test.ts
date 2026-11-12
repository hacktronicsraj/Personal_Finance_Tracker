import { describe, expect, it } from 'vitest';
import { parseCsv, parseFlashcardCsv } from '../src/csvParse';

describe('parseCsv', () => {
  it('splits simple rows', () => {
    expect(parseCsv('a,b,c\nd,e,f')).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCsv('"hello, world",b')).toEqual([['hello, world', 'b']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('"she said ""hi""",b')).toEqual([['she said "hi"', 'b']]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿a,b')).toEqual([['a', 'b']]);
  });

  it('drops trailing blank lines', () => {
    expect(parseCsv('a,b\n\n\n')).toEqual([['a', 'b']]);
  });

  it('flushes a final row with no trailing newline', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('parseFlashcardCsv', () => {
  const header = 'question,option1,option2,option3,option4,answer';

  it('parses a valid file and skips the header', () => {
    const csv = `${header}\n"What is KV cache?","Keys and values","Only keys","Gradients","Weights",0`;
    const { cards, errors, headerSkipped } = parseFlashcardCsv(csv);
    expect(headerSkipped).toBe(true);
    expect(errors).toEqual([]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual({
      question: 'What is KV cache?',
      options: ['Keys and values', 'Only keys', 'Gradients', 'Weights'],
      answer: 0,
      difficulty: 'medium',
    });
  });

  it('works without a header row', () => {
    const csv = 'Q1,A,B,C,D,2';
    const { cards, headerSkipped } = parseFlashcardCsv(csv);
    expect(headerSkipped).toBe(false);
    expect(cards[0].answer).toBe(2);
  });

  it('reads the optional difficulty column', () => {
    const csv = 'Q1,A,B,C,D,1,hard';
    expect(parseFlashcardCsv(csv).cards[0].difficulty).toBe('hard');
  });

  it('rejects an out-of-range answer index', () => {
    const { cards, errors } = parseFlashcardCsv('Q1,A,B,C,D,9');
    expect(cards).toHaveLength(0);
    expect(errors[0].reason).toMatch(/answer must be 0-3/);
  });

  it('rejects a non-numeric answer', () => {
    const { errors } = parseFlashcardCsv('Q1,A,B,C,D,x');
    expect(errors[0].reason).toMatch(/answer must be 0-3/);
  });

  it('rejects duplicate options', () => {
    const { errors } = parseFlashcardCsv('Q1,A,A,C,D,0');
    expect(errors[0].reason).toMatch(/duplicate options/);
  });

  it('rejects too few columns', () => {
    const { errors } = parseFlashcardCsv('Q1,A,B,0');
    expect(errors[0].reason).toMatch(/expected 6 columns/);
  });

  it('rejects an empty question', () => {
    const { errors } = parseFlashcardCsv(',A,B,C,D,0');
    expect(errors[0].reason).toMatch(/empty question/);
  });

  it('keeps good rows and reports bad ones separately', () => {
    const csv = ['Q1,A,B,C,D,0', 'Q2,A,B,C,D,9', 'Q3,W,X,Y,Z,3'].join('\n');
    const { cards, errors } = parseFlashcardCsv(csv);
    expect(cards.map((c) => c.question)).toEqual(['Q1', 'Q3']);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
  });

  it('reports 1-based line numbers that match a spreadsheet', () => {
    const csv = `${header}\nQ1,A,B,C,D,0\nQ2,A,B,C,D,bad`;
    const { errors } = parseFlashcardCsv(csv);
    expect(errors[0].line).toBe(3);
  });

  it('survives commas inside questions', () => {
    const csv = '"Which is true, and why?","a, b","c","d","e",0';
    const { cards } = parseFlashcardCsv(csv);
    expect(cards[0].question).toBe('Which is true, and why?');
    expect(cards[0].options[0]).toBe('a, b');
  });
});
