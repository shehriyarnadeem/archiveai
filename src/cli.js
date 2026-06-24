/**
 * Entry point for the ArchivAI CLI
 * 
 * This file handles:
 * 1. Parsing command-line arguments (like --path)
 * 2. Calling the git reader
 * 3. Displaying results
 * 4. Handling errors gracefully
 */

// Import our custom modules
import { getCommitHistory } from './git/reader.js';
import { logCommit, logError, logSuccess } from './utils/logger.js';

/**
 * Main function - runs when you type `npm start`
 * 
 * Why use an async main function?
 * - We need to await the git history
 * - Node.js doesn't support top-level await in CommonJS (only ES modules)
 * - Wrapping in an async function gives us a clean pattern
 */
async function main() {
  // process.argv contains all command-line arguments
  // process.argv[0] = path to Node.js executable
  // process.argv[1] = path to this script (cli.js)
  // process.argv[2...] = arguments passed by the user
  // 
  // Example: npm start -- --path /my/repo
  // process.argv = ['node', 'cli.js', '--path', '/my/repo']
  const args = process.argv.slice(2); // Remove first 2 items
  let repoPath = '.'; // Default to current directory
  
  // Simple argument parser (no external libraries needed)
  // We loop through args and look for --path followed by a value
  // This is manual but keeps dependencies to zero
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path' && i + 1 < args.length) {
      repoPath = args[i + 1];
      i++; // Skip the value so we don't process it again
    }
  }

  console.log(`📂 Reading git history from: ${repoPath}`);

  try {
    // Call our git reader - this is the main logic
    const commits = await getCommitHistory(repoPath);
    
    logSuccess(`Found ${commits.length} commits`);
    
    // Loop through each commit and display it
    commits.forEach((commit, index) => {
      logCommit(commit, index);
    });

    // Bonus: Show a summary table at the end
    // console.table is a Node.js built-in that formats arrays of objects as tables
    // Perfect for quick data exploration in the terminal
    console.log('\n📊 Summary:');
    console.table(commits.map(c => ({
      Hash: c.hash.substring(0, 8),
      Author: c.author,
      Date: c.date.toLocaleDateString(),
      Message: c.message.substring(0, 30) + (c.message.length > 30 ? '...' : '')
    })));

  } catch (error) {
    // If anything goes wrong, display a clean error message
    logError(error.message);
    process.exit(1); // Exit with error code (1 = failure)
  }
}

// Actually run the main function
// This is the entry point of execution
main();