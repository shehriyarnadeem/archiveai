/**
 * Cache commits to a local JSON file
 * Why? So we don't re-parse git every time
 * Speeds up subsequent runs
 */

import { promises as fs } from 'fs';
import path from 'path';

const CACHE_FILE = path.join(process.cwd(), 'commits.json');

/**
 * Save commits to cache
 * @param {Array} commits - Array of commit objects
 */
async function saveCommits(commits) {
  try {
    const data = JSON.stringify(commits, null, 2);
    await fs.writeFile(CACHE_FILE, data, 'utf-8');
    console.log(`💾 Cached ${commits.length} commits to ${CACHE_FILE}`);
  } catch (error) {
    console.warn('⚠️ Failed to cache commits:', error.message);
  }
}

/**
 * Load commits from cache
 * @returns {Array|null} - Returns commits or null if cache doesn't exist
 */
async function loadCommits() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    const commits = JSON.parse(data);
    // JSON has no Date type, so dates come back as strings — revive them
    // so consumers can call Date methods like toLocaleDateString().
    commits.forEach(c => { c.date = new Date(c.date); });
    console.log(`📂 Loaded ${commits.length} commits from cache`);
    return commits;
  } catch (error) {
    // Cache doesn't exist or is corrupted
    return null;
  }
}

/**
 * Check if cache exists
 */
async function cacheExists() {
  try {
    await fs.access(CACHE_FILE);
    return true;
  } catch {
    return false;
  }
}

export { saveCommits, loadCommits, cacheExists };