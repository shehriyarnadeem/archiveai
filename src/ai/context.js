/**
 * Context assembler for the AI "ask" feature.
 *
 * The headline feature is a single LLM call: "given our history, why did we do X?"
 * An LLM call is really just "send a string, get a string". This file builds that
 * *input* string — turning structured commit objects into one readable prompt the
 * model can reason over.
 *
 * Why a separate file (and mostly PURE functions)? Assembling the prompt has
 * nothing to do with the network or the OpenAI SDK. Keeping it isolated means we
 * can unit-test it with zero setup and no API key, and swap the AI provider later
 * without touching this logic.
 */

import { encoding_for_model, get_encoding } from 'tiktoken';

// The model we tokenize for. Token *counts* depend on the model's vocabulary, so
// to budget accurately we must count with the same tokenizer the model uses.
// (Model id is still TBD for the actual call — this only affects counting.)
const DEFAULT_MODEL = 'gpt-4o';

// tiktoken runs as a WebAssembly module. Its encoder allocates memory OUTSIDE
// JavaScript's garbage collector, so it must be explicitly freed — or reused.
// A CLI/REPL only ever needs one encoder, so we build it lazily and cache it.
// Why lazy? So merely importing this file (e.g. in a test) doesn't spin up WASM
// until something actually counts tokens.
let _encoder = null;
function getEncoder() {
  if (_encoder) return _encoder;
  try {
    // Picks the correct token vocabulary for the model (GPT-4o/4.1 -> o200k_base).
    _encoder = encoding_for_model(DEFAULT_MODEL);
  } catch {
    // If our tiktoken version doesn't know the model name, fall back to the
    // encoding the current GPT-4 family uses. Counting still works.
    _encoder = get_encoding('o200k_base');
  }
  return _encoder;
}

/**
 * Count tokens in a piece of text — EXACTLY, using the model's own tokenizer.
 *
 * @param {string} text
 * @returns {number} token count
 */
function countTokens(text) {
  // `.encode` returns the array of token ids; its length is the token count.
  return getEncoder().encode(text || '').length;
}

/**
 * Free the cached tiktoken encoder's WASM memory.
 *
 * Why expose this? Long-lived processes (or tests that import us repeatedly)
 * should release the off-heap memory when done. A one-shot CLI run can skip it —
 * the OS reclaims everything on exit — but it's good hygiene to offer.
 */
function disposeEncoder() {
  if (_encoder) {
    _encoder.free();
    _encoder = null;
  }
}

/**
 * Format ONE commit into a readable text block for the prompt.
 *
 * Why prose instead of raw JSON? Models read labelled plain text more reliably
 * than JSON, and we don't waste tokens on braces/quotes. We include only the
 * fields that explain *intent*: subject, body, and which files changed (the body
 * is where developers actually write "why").
 *
 * @param {Object} commit - a commit object from git/reader.js
 * @returns {string}
 */
function formatCommit(commit) {
  // Short hash is enough to identify a commit; the full 40 chars wastes tokens.
  const shortHash = commit.hash.substring(0, 8);

  // Dates are real Date objects in memory (cache.js revives them), so
  // toISOString() is safe and gives a stable, sortable date string.
  const date = commit.date.toISOString().split('T')[0]; // just YYYY-MM-DD

  // Summarize the file changes compactly: "3 file(s), +40/-12".
  const fileCount = commit.files?.length || 0;
  const changeSummary = `${fileCount} file(s), +${commit.totalInsertions || 0}/-${commit.totalDeletions || 0}`;

  // Build the block. The body is the most valuable part for "why" questions, so
  // we include it when present. `.trim()` avoids trailing blank lines piling up.
  const lines = [
    `commit ${shortHash} — ${date} — ${commit.author}`,
    `subject: ${commit.message}`,
  ];
  if (commit.body) {
    lines.push(`body: ${commit.body}`);
  }
  lines.push(`changes: ${changeSummary}`);

  return lines.join('\n').trim();
}

/**
 * Assemble commits + a question into a single prompt string, respecting a token
 * budget so we never overflow the model's context window.
 *
 * Strategy: commits arrive newest-first (that's how `git log` returns them). We
 * include commits until we'd exceed the budget, then stop — keeping the NEWEST
 * commits because recent history is usually most relevant to "why is it like this
 * *now*". (A smarter selection can come later — this is the simplest honest one.)
 *
 * @param {Array}  commits  - commit objects (newest first)
 * @param {string} question - the user's natural-language question
 * @param {Object} [options]
 * @param {number} [options.maxContextTokens=100000] - token budget for the history
 *                 portion (leave headroom for the question + the model's answer).
 * @returns {{ prompt: string, includedCommits: number, tokens: number, truncated: boolean }}
 */
function assembleContext(commits, question, options = {}) {
  const { maxContextTokens = 100_000 } = options;

  // Build the history block commit-by-commit, stopping before we bust the budget.
  const blocks = [];
  let usedTokens = 0;
  let truncated = false;

  for (const commit of commits) {
    const block = formatCommit(commit);
    const blockTokens = countTokens(block);

    // If adding this commit would exceed the budget, stop. We flag `truncated`
    // so the caller can honestly tell the user "I only looked at N commits".
    if (usedTokens + blockTokens > maxContextTokens) {
      truncated = true;
      break;
    }

    blocks.push(block);
    usedTokens += blockTokens;
  }

  // Join individual commits with a blank line so the model sees clear boundaries.
  const history = blocks.join('\n\n');

  // The final prompt: instructions, then the history, then the question.
  // Why this order? Clear instructions first set the task; the data comes next;
  // the actual question goes last so it's the freshest thing in context.
  const prompt = [
    'You are a software historian. Using ONLY the git commit history below,',
    'explain the reasoning and trade-offs behind the change the user asks about.',
    'Synthesize a narrative — do not just list commits. If the history does not',
    'contain the answer, say so honestly rather than guessing.',
    '',
    '=== GIT COMMIT HISTORY (newest first) ===',
    history,
    '=== END HISTORY ===',
    '',
    `Question: ${question}`,
  ].join('\n');

  return {
    prompt,                          // the string to send to the LLM
    includedCommits: blocks.length,  // how many commits we actually used
    tokens: countTokens(prompt),     // EXACT token count of the whole prompt
    truncated,                       // did we drop older commits to fit?
  };
}

export { assembleContext, formatCommit, countTokens, disposeEncoder };
