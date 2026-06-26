/**
 * The AI call for the "ask" feature.
 *
 * `context.js` builds the prompt string; THIS file sends it to OpenAI and streams
 * the answer back. It's the single LLM call at the heart of ArchivAI — not an
 * agent, just one Q&A request over the assembled history.
 *
 * Two design choices make this both robust and testable:
 *  1. STREAMING — we print tokens as they arrive instead of waiting for the whole
 *     answer. History payloads are large; a non-streaming call risks HTTP timeouts
 *     and gives the user a long, silent wait.
 *  2. DEPENDENCY INJECTION — the OpenAI client can be passed in. Real runs use the
 *     real SDK; tests pass a fake client that yields scripted chunks, so we can
 *     test the streaming loop with no network, no API key, and no cost.
 */

import OpenAI from 'openai';

// The model to ask. TBD per CLAUDE.md — overridable via env so we don't hardcode.
// gpt-4.1 offers a very large (1M-token) context window for big histories; gpt-4o
// is a cheaper default. Pick via OPENAI_MODEL without touching code.
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Lazily-created, cached OpenAI client. Why lazy? So merely importing this file
// (e.g. in a test, or to run `--help`) never demands an API key — the key is only
// needed when we actually make a call.
let _client = null;
function getClient() {
  if (_client) return _client;
  // The SDK reads OPENAI_API_KEY from the environment by default. We check it
  // ourselves first to give a friendly message instead of a cryptic SDK error.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set. Export it first:\n' +
      '  export OPENAI_API_KEY="sk-..."'
    );
  }
  _client = new OpenAI(); // picks up the key from the environment automatically
  return _client;
}

/**
 * Send a prompt to the model and stream the answer.
 *
 * @param {string} prompt - the assembled prompt from context.js
 * @param {Object} [options]
 * @param {string}   [options.model]   - model id (defaults to DEFAULT_MODEL)
 * @param {Object}   [options.client]  - an OpenAI-like client (for tests/injection)
 * @param {Function} [options.onToken] - called with each text chunk as it arrives;
 *                                        defaults to writing to stdout.
 * @returns {Promise<string>} the full answer text (handy for callers/tests)
 */
async function askQuestion(prompt, options = {}) {
  const {
    model = DEFAULT_MODEL,
    client = getClient(),
    onToken = (text) => process.stdout.write(text), // live output by default
  } = options;

  // Open a streaming chat completion. `stream: true` makes `create` resolve to an
  // async-iterable of partial chunks instead of one final response object.
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    messages: [
      // One user turn carrying the whole assembled prompt. The "historian"
      // instructions are already baked into the prompt by context.js.
      { role: 'user', content: prompt },
    ],
  });

  // Consume the stream. Each chunk carries a `delta` — the *new* bit of text since
  // the last chunk. We accumulate the full answer AND emit each piece live.
  let full = '';
  let refusal = '';
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]?.delta;
    // The content delta can be undefined on some chunks (e.g. role-only or the
    // final stop chunk), so default to '' and skip empties.
    const delta = choice?.content || '';
    if (delta) {
      full += delta;
      onToken(delta);
    }
    // A REFUSAL is not an error — the model is declining to answer, and it arrives
    // as its own field in the delta. We collect it so we can surface it clearly.
    if (choice?.refusal) {
      refusal += choice.refusal;
    }
  }

  // If the model refused and gave no real answer, make that explicit rather than
  // returning a confusing empty string. The caller's catch maps this to a message.
  if (refusal && !full.trim()) {
    throw new Error(`The model declined to answer: ${refusal.trim()}`);
  }

  return full;
}

/**
 * Translate an error into a friendly, actionable message.
 *
 * Why a separate PURE function? It maps an error object to a string with no I/O,
 * so we can unit-test every branch with fake error objects — no network, no key.
 * OpenAI SDK errors carry an HTTP `status` (401/429/404/...), which is the most
 * stable thing to switch on (more stable than class names or message text).
 *
 * @param {Error} error
 * @returns {string} a message safe to show the user
 */
function friendlyError(error) {
  // Our own pre-flight guard (missing key) already has a perfect message.
  if (error?.message?.includes('OPENAI_API_KEY')) return error.message;

  // Refusals are thrown by askQuestion with a ready-made message.
  if (error?.message?.startsWith('The model declined')) return error.message;

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  switch (error?.status) {
    case 401:
      return 'OpenAI rejected your API key (401). Check OPENAI_API_KEY is correct and active.';
    case 429:
      return 'Rate limited or out of quota (429). Wait a moment and retry, or check your OpenAI billing/usage limits.';
    case 404:
      return `Model not found (404). Check OPENAI_MODEL ("${model}") is a model your account can access.`;
    case 400:
      return `OpenAI rejected the request (400): ${error.message}`;
    case 500:
    case 502:
    case 503:
      return 'OpenAI had a server error on their end. Try again in a moment.';
  }

  // Connection-level failures don't have an HTTP status. The SDK names these
  // APIConnectionError; raw Node DNS/socket errors use codes like ENOTFOUND.
  const name = error?.name || '';
  const code = error?.code || '';
  if (name.includes('Connection') || code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
    return 'Could not reach OpenAI — check your internet connection and try again.';
  }

  // Anything we didn't anticipate: fall back to the raw message, never a stack trace.
  return error?.message || 'Unknown error while talking to OpenAI.';
}

export { askQuestion, friendlyError, DEFAULT_MODEL };
