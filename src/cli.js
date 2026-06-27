/**
 * Entry point for the ArchivAI CLI.
 *
 * ArchivAI does one thing: answer "why did we build it this way?" over your
 * project's git history. So the CLI *is* that Q&A interface — `npm start` drops
 * you straight into an interactive question loop. There is intentionally no REPL,
 * no commit-listing, no search/stats here anymore: those were scaffolding around
 * the data layer, not the product. The engine underneath (git reader → context
 * assembler → AI ask) is unchanged; this file is just the shell around it.
 *
 * File map (top → bottom): imports → config → arg parsing → history loading →
 * rendering one answer → run modes (interactive loop) → help → bootstrap + entry.
 *
 * Run `npm start -- --help` for usage.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { getCommitHistory } from './git/reader.js';
import { logError } from './utils/logger.js';
import { saveCommits, loadCommits, cacheExists } from './storage/cache.js';

// --- Config -----------------------------------------------------------------

// How many commits to pull from git for the session. This is an *internal* cap,
// not a user knob: the context assembler trims the oldest commits to fit the
// model's token budget anyway, so we read a generous slice and let it decide.
const HISTORY_LIMIT = 200;

// Words that end the interactive loop.
const EXIT_WORDS = ['exit', 'quit', 'q'];

// --- CLI argument parsing ----------------------------------------------------

/**
 * Parse command-line arguments into an options object.
 * Only three flags remain — everything else is treated as a (one-shot) question.
 *   npm start                         -> interactive Q&A
 *   npm start -- "why did we ...?"     -> answer once and exit
 *   npm start -- --path /repo --cache  -> target another repo, use the cache
 */
function parseArgs(argv) {
  const opts = { repoPath: '.', useCache: false, help: false, question: '' };

  // Non-flag args are collected as the question text (joined back with spaces).
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--path' && i + 1 < argv.length) opts.repoPath = argv[++i];
    else if (arg === '--cache') opts.useCache = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else positional.push(arg);
  }

  // Back-compat / muscle-memory: tolerate a leading "ask" keyword before the
  // question (the old `ask "..."` subcommand) without folding it into the text.
  if (positional[0]?.toLowerCase() === 'ask') positional.shift();

  opts.question = positional.join(' ').trim();
  return opts;
}

// --- Git history loading -----------------------------------------------------

/**
 * Load commits for the session, preferring the cache when asked.
 * Always quiet — the polished Q&A output shouldn't be cluttered by cache chatter.
 */
async function fetchCommits({ repoPath, useCache }) {
  if (useCache && (await cacheExists())) {
    const cached = await loadCommits({ quiet: true });
    if (cached?.length) return cached;
  }

  const commits = await getCommitHistory(repoPath, HISTORY_LIMIT);
  await saveCommits(commits, { quiet: true }); // refresh the cache for next time
  return commits;
}

// --- Rendering a single answer ----------------------------------------------

/**
 * Answer a single question: assemble the history into a prompt, stream the AI
 * answer, and print a stats footer. Shared by both the one-shot and interactive
 * paths so the experience (and the screenshot aesthetic) is identical.
 *
 * @param {Object} engine - the loaded modules + commits (see bootstrap()).
 * @param {string} question
 * @param {Object} [opts]
 * @param {boolean} [opts.showQuestion] - draw the question in a titled box first.
 *        On for one-shot (the question came from argv, so echo it); off in the
 *        loop (the user just typed it at the prompt — re-boxing it is noise).
 */
async function answer(engine, question, { showQuestion = false } = {}) {
  const { assembleContext, askQuestion, friendlyError, DEFAULT_MODEL,
          box, wrap, style, commits } = engine;

  // Turn commits into one prompt, respecting the token budget.
  const { prompt, includedCommits, tokens, truncated } =
    assembleContext(commits, question);

  if (showQuestion) {
    console.log(box(wrap(question, 60), { title: 'QUESTION', borderColor: 'cyan' }));
  }

  // Stream the answer live under a header; time it for the footer.
  console.log();
  console.log(style('❯ Answer', 'bold', 'green'));
  const started = Date.now();
  try {
    await askQuestion(prompt);
  } catch (error) {
    // Per-question errors (rate limit, transient network, refusal) must NOT kill
    // an interactive session — surface a friendly message and let the user retry.
    console.log();
    logError(friendlyError(error));
    return;
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  // Stats footer — the subtle "this is real engineering" signal.
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const truncNote = truncated ? ' · history truncated' : '';
  const footer =
    `${includedCommits} commits · ~${tokens.toLocaleString()} tokens · ${model} · ${elapsed}s${truncNote}`;
  console.log('\n' + box([footer], { borderColor: 'gray' }));
}

// --- Run modes ---------------------------------------------------------------

/**
 * The interactive Q&A loop: read a question, answer it, repeat until the user
 * types `exit` (or hits Ctrl-C). History is loaded once and reused across all
 * questions in the session.
 */
async function interactive(engine) {
  const { style, commits } = engine;
  const rl = readline.createInterface({ input, output });

  // Ctrl-C should quit cleanly, not dump a rejected-promise stack trace.
  rl.on('SIGINT', () => { rl.close(); process.exit(0); });

  console.log(style(
    `\nLoaded ${commits.length} commits. Ask anything about your project's history.`,
    'dim'));
  console.log(style("Type a question and press Enter — 'exit' or Ctrl-C to quit.", 'dim'));

  while (true) {
    let question;
    try {
      question = (await rl.question(style('\n❯ ', 'bold', 'cyan'))).trim();
    } catch {
      break; // stream closed (e.g. Ctrl-D) — treat as exit
    }
    if (!question) continue;
    if (EXIT_WORDS.includes(question.toLowerCase())) break;
    await answer(engine, question);
  }

  rl.close();
  console.log(style('\nGoodbye 👋', 'dim'));
}

// --- Help --------------------------------------------------------------------

function showHelp() {
  console.log(`
📚 ArchivAI — ask your codebase why.

USAGE:
  npm start                          Start the interactive Q&A interface
  npm start -- "<question>"          Ask one question and exit
  npm start -- --path <path>         Target another git repository
  npm start -- --cache               Use cached commits (faster startup)
  npm start -- --help, -h            Show this help

EXAMPLES:
  npm start
  npm start -- "why did we switch to ESM?"
  npm start -- --path /my/repo --cache

Requires OPENAI_API_KEY (optionally OPENAI_MODEL). Put them in a local .env.
`);
}

// --- Bootstrap & entry -------------------------------------------------------

/**
 * Load the heavy machinery once and bundle it into a single "engine" object the
 * answer/loop helpers share: the AI + tokenizer + UI modules, plus the session's
 * commits. Kept out of main() so the entry point stays a thin dispatcher — and so
 * none of this is paid for on the --help path.
 */
async function bootstrap(opts) {
  // Dynamic imports: the OpenAI SDK + WASM tokenizer + UI are expensive, so we
  // only load them here, once we know we're actually going to answer a question.
  const { assembleContext } = await import('./ai/context.js');
  const { askQuestion, friendlyError, DEFAULT_MODEL } = await import('./ai/ask.js');
  const { banner, box, wrap, style } = await import('./utils/ui.js');

  // The branded banner up front — the screenshot's centerpiece.
  console.log(banner());

  let commits;
  try {
    commits = await fetchCommits(opts);
  } catch (error) {
    logError(error.message);
    console.log('\n💡 Make sure you\'re in a git repo (or pass --path), and git is installed.');
    process.exit(1);
  }

  return {
    assembleContext, askQuestion, friendlyError, DEFAULT_MODEL,
    banner, box, wrap, style, commits,
  };
}

/**
 * Entry point: parse args, then dispatch. A question on the command line runs
 * one-shot (great for scripts/screenshots); its absence opens the interactive
 * interface. Everything heavy lives in bootstrap(), so this stays a dispatcher.
 */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return showHelp();

  const engine = await bootstrap(opts);

  if (opts.question) {
    await answer(engine, opts.question, { showQuestion: true });
    return;
  }
  await interactive(engine);
}

main();
