/**
 * Tests for the AI ask call. Run with: node --test
 *
 * No network and no API key: we INJECT a fake OpenAI-like client that yields a
 * scripted stream. This is exactly why askQuestion accepts a `client` option —
 * the streaming logic is testable in isolation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askQuestion, friendlyError } from './ask.js';

// Build a fake client whose chat.completions.create returns an async-iterable of
// chunks shaped like the real SDK's streaming chunks ({ choices:[{delta:{content}}] }).
function fakeClient(pieces) {
  return {
    chat: {
      completions: {
        async create() {
          // An async generator IS an async-iterable, so `for await` works on it
          // just like it does on the real stream.
          return (async function* () {
            for (const content of pieces) {
              yield { choices: [{ delta: { content } }] };
            }
            // A final stop chunk with no content — must be ignored, not crash.
            yield { choices: [{ delta: {} }] };
          })();
        },
      },
    },
  };
}

test('askQuestion concatenates streamed deltas into the full answer', async () => {
  const client = fakeClient(['Because ', 'CommonJS ', 'was painful.']);
  const answer = await askQuestion('why?', { client, onToken() {} });
  assert.equal(answer, 'Because CommonJS was painful.');
});

test('askQuestion emits each delta live via onToken', async () => {
  const client = fakeClient(['a', 'b', 'c']);
  const seen = [];
  await askQuestion('why?', { client, onToken: (t) => seen.push(t) });
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('askQuestion ignores empty/content-less chunks without throwing', async () => {
  // Includes an empty string and the trailing stop chunk (handled inside fakeClient).
  const client = fakeClient(['hi', '', ' there']);
  const answer = await askQuestion('why?', { client, onToken() {} });
  assert.equal(answer, 'hi there');
});

// A fake client that streams a REFUSAL (no content), to test the decline path.
function refusingClient() {
  return {
    chat: {
      completions: {
        async create() {
          return (async function* () {
            yield { choices: [{ delta: { refusal: "I can't help with that." } }] };
          })();
        },
      },
    },
  };
}

test('askQuestion throws a clear error when the model refuses with no answer', async () => {
  const client = refusingClient();
  await assert.rejects(
    () => askQuestion('why?', { client, onToken() {} }),
    /declined to answer.*can't help/i,
  );
});

test('friendlyError maps known HTTP status codes', () => {
  assert.match(friendlyError({ status: 401 }), /rejected your API key/i);
  assert.match(friendlyError({ status: 429 }), /rate limited|quota/i);
  assert.match(friendlyError({ status: 404 }), /model not found/i);
  assert.match(friendlyError({ status: 500 }), /server error/i);
});

test('friendlyError recognizes connection failures', () => {
  assert.match(friendlyError({ code: 'ENOTFOUND' }), /could not reach openai/i);
  assert.match(friendlyError({ name: 'APIConnectionError' }), /could not reach openai/i);
});

test('friendlyError passes through our missing-key and refusal messages', () => {
  const keyErr = new Error('OPENAI_API_KEY is not set. Export it first:');
  assert.equal(friendlyError(keyErr), keyErr.message);
  const refusal = new Error('The model declined to answer: nope');
  assert.equal(friendlyError(refusal), refusal.message);
});

test('friendlyError falls back to the raw message, never undefined', () => {
  assert.equal(friendlyError({ message: 'weird thing' }), 'weird thing');
  assert.equal(friendlyError({}), 'Unknown error while talking to OpenAI.');
});
