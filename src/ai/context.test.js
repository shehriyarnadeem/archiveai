/**
 * Tests for the context assembler. Run with: node --test
 *
 * These use Node's BUILT-IN test runner (node:test) and assert module — no
 * external test framework, and no API key, because context.js is pure logic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleContext, formatCommit, countTokens } from './context.js';

// A tiny fake commit so tests don't depend on a real repo.
function fakeCommit(overrides = {}) {
  return {
    hash: 'abcdef1234567890',
    author: 'Ada',
    email: 'ada@example.com',
    date: new Date('2026-01-02T00:00:00Z'),
    message: 'Switch to ESM',
    body: 'CommonJS was holding us back.',
    files: [{ filename: 'src/cli.js', insertions: 10, deletions: 2 }],
    totalInsertions: 10,
    totalDeletions: 2,
    ...overrides,
  };
}

test('countTokens returns a positive integer for non-empty text', () => {
  const n = countTokens('hello world');
  assert.ok(Number.isInteger(n) && n > 0);
});

test('countTokens treats empty/undefined as 0 tokens', () => {
  assert.equal(countTokens(''), 0);
  assert.equal(countTokens(undefined), 0);
});

test('formatCommit includes subject, body, and change summary', () => {
  const block = formatCommit(fakeCommit());
  assert.match(block, /Switch to ESM/);          // subject
  assert.match(block, /CommonJS was holding/);   // body
  assert.match(block, /\+10\/-2/);               // change summary
  assert.match(block, /2026-01-02/);             // ISO date (YYYY-MM-DD)
});

test('formatCommit omits the body line when body is empty', () => {
  const block = formatCommit(fakeCommit({ body: '' }));
  assert.doesNotMatch(block, /body:/);
});

test('assembleContext puts the question last and reports included commits', () => {
  const commits = [fakeCommit(), fakeCommit({ message: 'Add cache' })];
  const result = assembleContext(commits, 'Why ESM?');
  assert.equal(result.includedCommits, 2);
  assert.equal(result.truncated, false);
  assert.ok(result.tokens > 0);
  // The question should appear at the very END of the prompt.
  assert.match(result.prompt, /Question: Why ESM\?\s*$/);
});

test('assembleContext truncates when the budget is tiny', () => {
  const commits = [fakeCommit(), fakeCommit(), fakeCommit()];
  // A 5-token budget can't fit even one full commit block.
  const result = assembleContext(commits, 'Why?', { maxContextTokens: 5 });
  assert.equal(result.truncated, true);
  assert.ok(result.includedCommits < commits.length);
});
