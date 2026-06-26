/**
 * Interactive REPL for ArchivAI
 * Ask questions about your codebase history
 */

import readline from 'readline';
import { loadCommits, cacheExists } from './storage/cache.js';
import { searchByKeyword, getTopAuthors } from './search/search.js';
import { logSuccess } from './utils/logger.js';

function createRepl() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🔍 ArchivAI> '
  });

  let commits = [];
  let loaded = false;

  console.log('\n🧠 ArchivAI Interactive Mode');
  console.log('Type your questions or commands:');
  console.log('  - "search <keyword>" - Find commits by keyword');
  console.log('  - "top authors" - Show most active contributors');
  console.log('  - "recent <n>" - Show last n commits');
  console.log('  - "stats" - Show commit statistics');
  console.log('  - "help" - Show this message');
  console.log('  - "exit" or Ctrl+C - Quit\n');

  async function loadData() {
    if (!await cacheExists()) {
      console.log('⚠️ No cache found. Run `npm start -- --cache` first to cache commits.');
      return false;
    }
    
    commits = await loadCommits();
    if (!commits || commits.length === 0) {
      console.log('⚠️ No commits loaded.');
      return false;
    }
    
    loaded = true;
    logSuccess(`Loaded ${commits.length} commits. Ready!`);
    return true;
  }

  async function handleCommand(input) {
    const trimmed = input.trim();
    
    if (!trimmed) return;

    // Exit commands
    if (trimmed === 'exit' || trimmed === 'quit') {
      console.log('👋 Goodbye!');
      rl.close();
      return;
    }

    // Help
    if (trimmed === 'help') {
      console.log('\n📖 Commands:');
      console.log('  search <keyword>    - Search commits by keyword');
      console.log('  top authors         - Show top contributors');
      console.log('  recent <n>          - Show last n commits');
      console.log('  stats               - Show statistics');
      console.log('  help                - Show this message');
      console.log('  exit                - Quit\n');
      return;
    }

    // Load data if not loaded
    if (!loaded) {
      const ok = await loadData();
      if (!ok) return;
    }

    // Search
    if (trimmed.startsWith('search ')) {
      const keyword = trimmed.substring(7);
      const results = searchByKeyword(commits, keyword);
      
      if (results.length === 0) {
        console.log(`❌ No commits found for "${keyword}"`);
      } else {
        console.log(`\n✅ Found ${results.length} commits for "${keyword}":`);
        results.forEach((c, i) => {
          console.log(`  ${i+1}. ${c.hash.substring(0,8)} | ${c.date.toLocaleDateString()} | ${c.message}`);
        });
        console.log('');
      }
      return;
    }

    // Top authors
    if (trimmed === 'top authors') {
      const top = getTopAuthors(commits);
      console.log('\n🏆 Top Contributors:');
      top.forEach((t, i) => {
        console.log(`  ${i+1}. ${t.author}: ${t.count} commits`);
      });
      console.log('');
      return;
    }

    // Recent commits
    if (trimmed.startsWith('recent ')) {
      const num = parseInt(trimmed.substring(7)) || 10;
      const recent = commits.slice(0, Math.min(num, commits.length));
      console.log(`\n📋 Last ${recent.length} commits:`);
      recent.forEach((c, i) => {
        console.log(`  ${i+1}. ${c.hash.substring(0,8)} | ${c.author} | ${c.date.toLocaleDateString()}`);
        console.log(`     ${c.message}`);
      });
      console.log('');
      return;
    }

    // Stats
    if (trimmed === 'stats') {
      const totalCommits = commits.length;
      const totalFiles = commits.reduce((sum, c) => sum + (c.files?.length || 0), 0);
      const totalInsertions = commits.reduce((sum, c) => sum + (c.totalInsertions || 0), 0);
      const totalDeletions = commits.reduce((sum, c) => sum + (c.totalDeletions || 0), 0);
      
      console.log('\n📊 Repository Statistics:');
      console.log(`  Total commits:      ${totalCommits}`);
      console.log(`  Total files changed: ${totalFiles}`);
      console.log(`  Total insertions:   +${totalInsertions}`);
      console.log(`  Total deletions:    -${totalDeletions}`);
      console.log(`  Net change:         ${totalInsertions - totalDeletions}`);
      console.log('');
      return;
    }

    console.log(`❌ Unknown command: "${trimmed}". Type "help" for options.`);
  }

  rl.on('line', async (line) => {
    await handleCommand(line);
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });

  rl.prompt();
}

export { createRepl };