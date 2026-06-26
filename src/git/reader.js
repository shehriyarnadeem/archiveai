import { promisify } from 'util'
import { exec } from 'child_process'

// promisify takes a callback-based function and converts it to a Promise-based one
// Why? Because without promisify, exec uses callbacks:
//   exec('git log', (error, stdout, stderr) => { ... })
//
// With promisify, we can use modern async/await syntax instead of nested callbacks
// This makes our code cleaner, more readable, and easier to handle errors
//
// Problem promisify solves: Node.js has many callback-based functions (legacy API)
// Solution: promisify wraps them to return Promises, so we can use async/await
const execPromise = promisify(exec);

// Separator characters used to slice up git's output.
//
// Why not '|' anymore? The old format used '|' between fields, but now we also
// capture the commit *body* (%b), which is free-form multi-line text that can
// contain '|', newlines, tabs — anything. A printable separator is unsafe.
//
// Solution: ASCII control characters that effectively never appear in commit text.
//   - UNIT_SEP  (0x1f) separates FIELDS within one commit (hash, author, ...)
//   - RECORD_SEP(0x1e) separates one COMMIT record from the next
// In git's --pretty format these are written as %x1f and %x1e.
const UNIT_SEP = '\x1f';
const RECORD_SEP = '\x1e';

/**
 * Fetch commit history from a git repository.
 *
 * @param {string} repoPath - File system path to the git repo (defaults to current dir)
 * @param {number} limit    - Max number of commits to read (defaults to 20)
 * @returns {Promise<Array>} Array of commit objects:
 *   { hash, author, email, date, message, body, files, totalInsertions, totalDeletions }
 *
 * Why async? Because we're waiting for a system command (git log) to complete —
 * this could take 100ms or several seconds depending on repo size.
 */
async function getCommitHistory(repoPath = '.', limit = 20) {
  try {
    // Guard the limit before interpolating it into a shell command.
    // Why? `limit` flows in from CLI args (parseInt can yield NaN/negatives).
    // Coercing to a safe positive integer prevents a malformed/injected `-n`.
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;

    // Build the git command.
    //
    // --pretty=format fields (in order, each followed by %x1f = UNIT_SEP):
    //   %H  = full commit hash        %an = author name      %ae = author email
    //   %at = author timestamp (Unix) %s  = subject (1st line) %b  = body (rest)
    // The leading %x1e (RECORD_SEP) marks the start of each commit record.
    //
    // --numstat appends machine-readable per-file change counts AFTER the format,
    // one line per file: "<insertions>\t<deletions>\t<filename>". Binary files
    // report "-\t-" instead of numbers.
    const format = `${RECORD_SEP}%H${UNIT_SEP}%an${UNIT_SEP}%ae${UNIT_SEP}%at${UNIT_SEP}%s${UNIT_SEP}%b${UNIT_SEP}`;
    const command = `git log --numstat --pretty=format:"${format}" -n ${safeLimit}`;

    // Execute the git command in the specified repository path.
    // Why cwd? It tells git "run as if from this directory" instead of wherever
    // the Node process started.
    //
    // Why maxBuffer? Capturing bodies + numstat for many commits can exceed
    // exec's default 1MB stdout cap; we raise it to 50MB to be safe.
    const { stdout, stderr } = await execPromise(command, {
      cwd: repoPath,
      maxBuffer: 50 * 1024 * 1024,
    });

    // Git sometimes writes warnings to stderr even on success — log, don't fail.
    if (stderr) {
      console.warn('Git stderr:', stderr);
    }

    // Split the whole output into per-commit chunks on RECORD_SEP.
    // The output begins with a RECORD_SEP, so the first chunk is empty — the
    // filter drops empty/whitespace-only chunks.
    const records = stdout.split(RECORD_SEP).filter(chunk => chunk.trim() !== '');

    // Turn each raw record into a structured commit object.
    const commits = records.map(record => {
      // Split the record into its fields on UNIT_SEP. There are 6 format fields,
      // and everything after the final separator is the numstat block.
      const [hash, author, email, timestamp, subject, body, numstatBlock = ''] =
        record.split(UNIT_SEP);

      // Parse the numstat block into per-file change stats.
      const { files, totalInsertions, totalDeletions } = parseNumstat(numstatBlock);

      return {
        hash,                                        // Full SHA (e.g., "a1b2c3d4...")
        author,                                      // Committer name
        email,                                       // Committer email
        date: new Date(parseInt(timestamp) * 1000),  // Unix seconds -> JS Date (ms)
        message: subject,                            // Subject line (kept as `message` for the UI)
        body: (body || '').trim(),                   // Full body text (may be empty)
        files,                                       // [{ filename, insertions, deletions }]
        totalInsertions,                             // Sum of insertions across files
        totalDeletions,                              // Sum of deletions across files
      };
    });

    return commits;
  } catch (error) {
    // If git fails (not a repo, empty repo, etc.) wrap it in a friendlier error.
    // Common failures:
    // - "fatal: not a git repository" → wrong path
    // - "...does not have any commits yet" → empty repo
    throw new Error(`Failed to read git history: ${error.message}`);
  }
}

/**
 * Parse a git --numstat block for a single commit.
 *
 * @param {string} block - Text after the format fields, e.g. "\n3\t1\tsrc/a.js\n-\t-\tlogo.png"
 * @returns {{ files: Array, totalInsertions: number, totalDeletions: number }}
 *
 * Why a separate function? Parsing numstat is a self-contained concern with its
 * own edge cases (binary files, blank lines), so isolating it keeps the main
 * parser readable and makes this logic easy to test on its own.
 */
function parseNumstat(block) {
  const files = [];
  let totalInsertions = 0;
  let totalDeletions = 0;

  // Each non-empty line is one changed file: "<insertions>\t<deletions>\t<name>".
  const lines = block.split('\n').map(l => l.trim()).filter(l => l !== '');

  for (const line of lines) {
    // Split into at most 3 parts; the filename can itself contain tabs in rare
    // cases, so rejoin anything past the second tab back into the name.
    const [added, deleted, ...nameParts] = line.split('\t');
    const filename = nameParts.join('\t');

    // Binary files report "-" instead of a count — treat those as 0.
    const insertions = added === '-' ? 0 : parseInt(added, 10) || 0;
    const deletions = deleted === '-' ? 0 : parseInt(deleted, 10) || 0;

    files.push({ filename, insertions, deletions });
    totalInsertions += insertions;
    totalDeletions += deletions;
  }

  return { files, totalInsertions, totalDeletions };
}

export { getCommitHistory };