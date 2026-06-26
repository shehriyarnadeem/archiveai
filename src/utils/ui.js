/**
 * Presentation layer for ArchivAI — banner, colors, and bordered panels.
 *
 * Why a dedicated UI module? To keep *formatting* out of *logic*. Nothing here
 * knows about git or OpenAI; it just draws nice things. That means cli.js/ask.js
 * stay focused on behavior, and the whole look can be restyled in one place.
 *
 * Zero dependencies: terminal color is just escape-code strings, and boxes are
 * just Unicode box-drawing characters. No chalk/boxen/figlet needed.
 */

// --- Color ------------------------------------------------------------------

// ANSI escape codes. "\x1b[" starts a code, the number picks the style, "m" ends
// it, and code 0 resets back to normal. e.g. cyan text = "\x1b[36m...\x1b[0m".
const CODES = {
  reset: 0, bold: 1, dim: 2,
  red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90,
};

// Disable color when output isn't a terminal (piped to a file, another program)
// or when the user sets NO_COLOR. Why? Escape codes become ugly garbage like
// "[36m" in files/logs, and respecting NO_COLOR is a community convention.
const colorEnabled =
  process.env.FORCE_COLOR === '1' ||
  (process.stdout.isTTY && !process.env.NO_COLOR);

/**
 * Wrap text in one or more ANSI styles, then reset.
 * @param {string} text
 * @param  {...string} styles - names from CODES, e.g. style('hi', 'bold', 'cyan')
 */
function style(text, ...styles) {
  if (!colorEnabled) return text; // plain text when color is off
  const open = styles.map(s => `\x1b[${CODES[s]}m`).join('');
  return `${open}${text}\x1b[${CODES.reset}m`;
}

// --- Banner -----------------------------------------------------------------

// Hand-made ASCII logo (a "figlet"-style block font). It's just a template
// string — printing art is free.
const LOGO = String.raw`
 █████╗ ██████╗  ██████╗██╗  ██╗██╗██╗   ██╗ █████╗ ██╗
██╔══██╗██╔══██╗██╔════╝██║  ██║██║██║   ██║██╔══██╗██║
███████║██████╔╝██║     ███████║██║██║   ██║███████║██║
██╔══██║██╔══██╗██║     ██╔══██║██║╚██╗ ██╔╝██╔══██║██║
██║  ██║██║  ██║╚██████╗██║  ██║██║ ╚████╔╝ ██║  ██║██║
╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═══╝  ╚═╝  ╚═╝╚═╝`;

/** Return the colored banner + tagline as a string. */
function banner() {
  const tagline = '      a time machine for your codebase';
  return `${style(LOGO, 'cyan', 'bold')}\n${style(tagline, 'dim')}\n`;
}

// --- Text wrapping ----------------------------------------------------------

/**
 * Wrap a long string to a max line width, breaking on spaces (word wrap).
 * Why? So a long question doesn't overflow a fixed-width box.
 *
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]} lines, each <= maxWidth (long single words may exceed it)
 */
function wrap(text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && (line.length + 1 + word.length) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// --- Boxes ------------------------------------------------------------------

/**
 * Draw a bordered panel around content lines, with an optional title in the top
 * border (e.g. ┌─ QUESTION ──────┐).
 *
 * The width is computed from the longest content line (and the title), so the
 * box always fits snugly. We measure RAW (uncolored) text so embedded escape
 * codes can't throw off the math — then color only the borders.
 *
 * @param {string[]} lines - content lines (already short enough to fit)
 * @param {Object} [opts]
 * @param {string} [opts.title] - optional label shown in the top border
 * @param {string} [opts.borderColor='gray']
 * @returns {string}
 */
function box(lines, { title = null, borderColor = 'gray' } = {}) {
  // Inner content width = the longest line, but at least wide enough for a title.
  const contentWidth = Math.max(
    ...lines.map(l => l.length),
    title ? title.length + 1 : 0,
  );

  // Horizontal run length between the corners (one space of padding each side).
  const span = contentWidth + 2;
  const dash = (n) => '─'.repeat(Math.max(0, n));

  // Top border — with or without an embedded title.
  const top = title
    ? `┌─ ${style(title, 'bold')} ${dash(span - (title.length + 3))}┐`
    : `┌${dash(span)}┐`;
  const bottom = `└${dash(span)}┘`;

  // Each content line: "│ " + text padded to contentWidth + " │".
  const body = lines.map(l => `│ ${l.padEnd(contentWidth)} │`);

  // Color only the frame characters, leaving content readable/unstyled.
  return [
    style(top, borderColor),
    ...body.map(b => style(b, borderColor)),
    style(bottom, borderColor),
  ].join('\n');
}

export { style, banner, wrap, box };
