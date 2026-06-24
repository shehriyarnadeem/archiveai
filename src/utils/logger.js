/**
 * Logger utility - keeps all console output in one place
 * 
 * Why have a separate logger file?
 * 1. Consistency - all messages look the same
 * 2. Flexibility - later we can change where logs go (file, database, etc.)
 * 3. Clean code - main logic isn't cluttered with console.log statements
 */

/**
 * Display a single commit with nice formatting
 * 
 * @param {Object} commit - The commit object from getCommitHistory
 * @param {number} index - Position in the array (0-based)
 */
function logCommit(commit, index) {
  // Emojis make terminal output more readable at a glance
  console.log(`\n📦 Commit #${index + 1}`);
  console.log(`  Hash:    ${commit.hash.substring(0, 8)}...`); // First 8 chars only
  console.log(`  Author:  ${commit.author} <${commit.email}>`);
  console.log(`  Date:    ${commit.date.toLocaleString()}`); // Human-readable date
  console.log(`  Message: ${commit.message}`);
}

/**
 * Display an error message with consistent styling
 */
function logError(message) {
  console.error(`❌ Error: ${message}`);
}

/**
 * Display a success message with consistent styling
 */
function logSuccess(message) {
  console.log(`✅ ${message}`);
}

export { logCommit, logError, logSuccess };