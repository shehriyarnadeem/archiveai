/**
 * Search commits by keyword
 * Simple grep-style search
 */

/**
 * Search commits by keyword across subject, body, author, and filenames.
 * Matching is case-insensitive.
 *
 * @param {Array} commits - Array of commit objects
 * @param {string} keyword - Search term
 * @returns {Array} - Filtered commits
 */
function searchByKeyword(commits, keyword) {
  // Normalize the search term once. Why lowercase? `String.includes` is
  // case-sensitive, so we lowercase BOTH the keyword and each field below —
  // that makes "INITIAL", "Initial", and "initial" all match the same text.
  const lowerKeyword = keyword.toLowerCase();

  return commits.filter(commit => {
    // Collect every text field worth searching into one list ("haystacks").
    // Why a list instead of separate if-blocks? It guards every field against
    // undefined in one place, includes the body we added in Phase 1, and lets
    // us add future sources (PR text, Jira) by appending one entry.
    const haystacks = [
      commit.message,                                  // subject line
      commit.body,                                     // full commit body
      commit.author,                                   // committer name
      ...(commit.files || []).map(f => f.filename),    // changed filenames
    ];

    // `(text || '')` turns a missing field into an empty string so .toLowerCase()
    // never throws. `.some()` returns true as soon as any field contains the term.
    return haystacks.some(text =>
      (text || '').toLowerCase().includes(lowerKeyword)
    );
  });
}

/**
 * Group commits by author
 */
function groupByAuthor(commits) {
  const groups = {};
  commits.forEach(commit => {
    const author = commit.author || 'Unknown';
    if (!groups[author]) groups[author] = [];
    groups[author].push(commit);
  });
  return groups;
}

/**
 * Get most active authors
 */
function getTopAuthors(commits, limit = 5) {
  const groups = groupByAuthor(commits);
  return Object.entries(groups)
    .map(([author, commits]) => ({ author, count: commits.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export { searchByKeyword, groupByAuthor, getTopAuthors };