/**
 * Entry point for the ArchivAI CLI
 *
 * Parses CLI args, loads commits (from git or cache), and displays them.
 * Run `npm start -- --help` for usage.
 */

import { getCommitHistory } from './git/reader.js';
import { logCommit, logError, logSuccess } from './utils/logger.js';
import { saveCommits, loadCommits, cacheExists } from './storage/cache.js';
import { getTopAuthors } from './search/search.js';

/**
 * Parse command-line arguments into an options object.
 * Example: npm start -- --path /my/repo --limit 10 --cache --repl
 */
function parseArgs(argv) {
  const opts = {
    repoPath: '.', limit: 20, useCache: false, replMode: false, help: false,
    command: null, question: '',
  };

  // Anything that isn't a recognized flag is a "positional" arg. We collect those
  // separately so we can support a subcommand + free-text, e.g.
  //   ask "why did we switch to ESM?"
  // Here positional[0] = "ask" and the rest is the question.
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--path' && i + 1 < argv.length) opts.repoPath = argv[++i];
    else if (arg === '--limit' && i + 1 < argv.length) opts.limit = parseInt(argv[++i], 10);
    else if (arg === '--cache') opts.useCache = true;
    else if (arg === '--repl') opts.replMode = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else positional.push(arg);
  }

  if (positional.length > 0) {
    opts.command = positional[0];               // e.g. "ask"
    opts.question = positional.slice(1).join(' '); // the rest, rejoined with spaces
  }

  return opts;
}

/**
 * Load commits, preferring the cache when requested and available.
 * Falls back to a fresh git read (and refreshes the cache) otherwise.
 */
async function fetchCommits({ repoPath, limit, useCache, quiet = false }) {
  // `quiet` suppresses the progress chatter — used by the `ask` command so its
  // polished output isn't cluttered by cache messages.
  if (useCache && (await cacheExists())) {
    const cached = await loadCommits({ quiet });
    if (cached) {
      if (!quiet) logSuccess(`Loaded ${cached.length} commits from cache`);
      if (limit && limit < cached.length) {
        if (!quiet) console.log(`📊 Showing ${limit} of ${cached.length} commits (limited by --limit ${limit})`);
        return cached.slice(0, limit);
      }
      return cached;
    }
    if (!quiet) console.log('⚠️ Cache is empty or corrupted. Fetching fresh...');
  }

  const commits = await getCommitHistory(repoPath, limit);
  if (!quiet) console.log(`💾 Saving ${commits.length} commits to cache...`);
  await saveCommits(commits, { quiet });
  return commits;
}

/**
 * Handle the `ask` subcommand: load commits, assemble them into a prompt, and
 * stream an AI answer to the user's question.
 *
 * Why lazy-import the AI modules? `ask.js` pulls in the OpenAI SDK and
 * `context.js` boots a WASM tokenizer — heavy things a plain `npm start` should
 * never load. We only import them on the ask path (same trick we use for --repl).
 */
async function handleAsk(opts) {
  // No question? Show how to use it instead of sending an empty prompt.
  if (!opts.question) {
    logError('Please provide a question, e.g.\n  npm start -- ask "why did we switch to ESM?"');
    process.exit(1);
  }

  const { assembleContext } = await import('./ai/context.js');
  const { askQuestion, friendlyError, DEFAULT_MODEL } = await import('./ai/ask.js');
  const { banner, box, wrap, style } = await import('./utils/ui.js');

  // Show the branded banner up front — this is the screenshot's centerpiece.
  console.log(banner());

  try {
    // Load commits quietly so cache messages don't clutter the polished output.
    const commits = await fetchCommits({ ...opts, quiet: true });

    // Turn commits into one prompt, respecting the token budget.
    const { prompt, includedCommits, tokens, truncated } =
      assembleContext(commits, opts.question);

    // The question, framed in a titled panel (wrapped so long questions fit).
    console.log(box(wrap(opts.question, 60), { title: 'QUESTION', borderColor: 'cyan' }));
    console.log();

    // Stream the answer live, under a header. askQuestion prints each token as it
    // arrives; we time the call to show latency in the footer.
    console.log(style('❯ Answer', 'bold', 'green'));
    const started = Date.now();
    await askQuestion(prompt);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    // Stats footer — the subtle "this is real engineering" signal.
    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const truncNote = truncated ? ' · history truncated' : '';
    const footer =
      `${includedCommits} commits · ~${tokens.toLocaleString()} tokens · ${model} · ${elapsed}s${truncNote}`;
    console.log('\n' + box([footer], { borderColor: 'gray' }));
  } catch (error) {
    // Map SDK/network/refusal errors to a clear, actionable message —
    // never a raw stack trace.
    logError(friendlyError(error));
    process.exit(1);
  }
}

/** Print a summary table of commits with diff stats. */
function printSummary(commits) {
  console.log('\n📊 Summary:');
  console.table(commits.map(c => {
    const msg = c.message || '';
    return {
      Hash: c.hash.substring(0, 8),
      Author: c.author,
      Date: c.date.toLocaleDateString(),
      Files: c.files?.length || 0,
      Changes: `+${c.totalInsertions || 0}/-${c.totalDeletions || 0}`,
      Message: msg.length > 30 ? msg.substring(0, 30) + '...' : msg,
    };
  }));
}

/** Print the top contributors (only meaningful with more than one commit). */
function printTopAuthors(commits) {
  if (commits.length <= 1) return;
  console.log('\n🏆 Top Contributors:');
  getTopAuthors(commits, 3).forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.author}: ${t.count} commits`);
  });
}

function printNextSteps() {
  console.log('\n💡 Next steps:');
  console.log('  - Run with --repl to query your commits interactively');
  console.log('  - Run with --cache to use cached data (faster startup)');
  console.log('  - Try: npm start -- --repl');
}

function showHelp() {
  console.log(`
📚 ArchivAI CLI - Help

USAGE:
  npm start [COMMAND] [OPTIONS]

COMMANDS:
  ask "<question>"  Ask the AI why something in your history happened
                    (needs OPENAI_API_KEY; optionally OPENAI_MODEL)

OPTIONS:
  --path <path>     Path to git repository (default: current directory)
  --limit <number>  Number of commits to show (default: 20)
  --cache           Use cached commits from commits.json (faster)
  --repl            Start interactive REPL mode
  --help, -h        Show this help message

EXAMPLES:
  npm start                                    # Show last 20 commits
  npm start -- ask "why did we switch to ESM?" # Ask the AI about your history
  npm start -- --path /my/repo --limit 10      # Show 10 commits from specific repo
  npm start -- --cache                         # Load from cache
  npm start -- --repl                          # Interactive query mode

REPL COMMANDS (in --repl mode):
  search <keyword>  - Find commits by keyword
  top authors       - Show top contributors
  recent <n>        - Show last n commits
  stats             - Show repository statistics
  help              - Show this message
  exit              - Quit
`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) return showHelp();

  // The AI Q&A command takes priority over the default "list commits" behavior.
  if (opts.command === 'ask') return handleAsk(opts);

  if (opts.replMode) {
    const { createRepl } = await import('./repl.js');
    console.log('🧠 Starting ArchivAI Interactive Mode...\n');
    return createRepl();
  }

  console.log(`📂 Reading git history from: ${opts.repoPath}`);

  try {
    const commits = await fetchCommits(opts);
    logSuccess(`Found ${commits.length} commits`);

    commits.forEach(logCommit);
    printSummary(commits);
    printTopAuthors(commits);
    printNextSteps();
  } catch (error) {
    logError(error.message);
    console.log('\n💡 Troubleshooting tips:');
    console.log('  1. Make sure you\'re in a git repository');
    console.log('  2. Try running with --path to specify a different repo');
    console.log('  3. Check if git is installed: git --version');
    process.exit(1);
  }
}

main();
