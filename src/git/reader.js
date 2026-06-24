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

/**
 * Fetch commit history from a git repository
 * 
 * @param {string} repoPath - File system path to the git repo (defaults to current dir)
 * @returns {Promise<Array>} Array of commit objects with hash, author, email, date, message
 * 
 * Why async? Because we're waiting for a system command (git log) to complete
 * This could take 100ms or 5 seconds depending on repo size
 */
async function getCommitHistory(repoPath = '.') {
  try {
    // Build the git command with a custom format
    // %H = full commit hash
    // %an = author name
    // %ae = author email
    // %at = author timestamp (Unix seconds since 1970)
    // %s = subject line (first line of commit message)
    // 
    // Why pipe (|) as separator? It's unlikely to appear in commit messages
    // We use -n 20 to limit to last 20 commits (performance optimization)
    const command = `git log --pretty=format:"%H|%an|%ae|%at|%s" -n 20`;
    
    // Execute the git command in the specified repository path
    // execPromise returns { stdout, stderr } - both are strings
    // 
    // Why cwd option? It tells the git command "pretend you're running from this directory"
    // Without this, git would run from wherever the Node.js process started
    const { stdout, stderr } = await execPromise(command, {
      cwd: repoPath
    });

    // Git sometimes outputs warnings to stderr even when successful
    // We log them but don't fail the operation
    if (stderr) {
      console.warn('Git stderr:', stderr);
    }

    // stdout is a big string with lines separated by newline characters
    // .trim() removes trailing whitespace (including the final newline)
    // .split('\n') converts the string into an array of lines
    // Example: "abc|John|john@x.com|1234567890|Fixed bug" 
    //          becomes ["abc|John|john@x.com|1234567890|Fixed bug"]
    const lines = stdout.trim().split('\n');
    
    // Transform each line into a structured JavaScript object
    // This is called "data transformation" or "parsing"
    const commits = lines.map(line => {
      // Split each line by the pipe character we used in the git format
      // The spread operator (...messageParts) captures everything after the 4th pipe
      // This handles edge case where commit message itself contains '|'
      const [hash, author, email, timestamp, ...messageParts] = line.split('|');
      const message = messageParts.join('|'); // Rejoin if message had pipes
      
      return {
        hash,                                    // Full SHA (e.g., "a1b2c3d4...")
        author,                                  // Name of committer
        email,                                   // Email of committer
        date: new Date(parseInt(timestamp) * 1000), // Convert Unix seconds to milliseconds
        message                                  // Commit subject
      };
    });

    return commits;
  } catch (error) {
    // If git command fails (e.g., not a git repo, or no commits), we catch the error
    // and throw a custom error with a helpful message
    // 
    // Common failures:
    // - "fatal: not a git repository" → wrong path
    // - "fatal: your current branch 'main' does not have any commits yet" → empty repo
    throw new Error(`Failed to read git history: ${error.message}`);
  }
}

export { getCommitHistory };