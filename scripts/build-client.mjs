#!/usr/bin/env node
/**
 * Builds `lib/client.js` from the sources in `src/`.
 *
 * The Web client loads a single self-contained script through
 * `window.__ModuleLoader__.load`, so the readable sources are concatenated in
 * order: head (module header, tokens, icons) → styles → strings → logic →
 * views → tail (RPC descriptors, apply, exports).
 *
 * The stylesheet is embedded as a JSON string, which keeps CSS backticks and
 * `${` sequences from being read as template interpolation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = (name) => fs.readFileSync(path.join(root, 'src', name), 'utf8');

/**
 * The panel needs the same limits the Host enforces (summary, title, triggers).
 * Read them out of `lib/format.js` instead of keeping a second copy in the UI.
 */
function sharedConstants() {
  const format = fs.readFileSync(path.join(root, 'lib', 'format.js'), 'utf8');
  const wanted = ['SUMMARY_LIMIT', 'TITLE_LIMIT', 'TRIGGER_LIMIT', 'INDEX_TRIGGER_LIMIT', 'INJECT_ITEM_LIMIT', 'INJECT_BYTE_LIMIT'];
  const lines = [];
  for (const name of wanted) {
    const match = format.match(new RegExp(`export const ${name} = ([^;]+);`));
    if (match === null) throw new Error(`lib/format.js does not export ${name}`);
    lines.push(`    const ${name} = ${match[1].trim()};`);
  }
  return lines.join('\n');
}

const head = src('head.js').replace('    // @KIRA_CONSTANTS@ —', `    // Generated from lib/format.js at build time.\n${sharedConstants()}\n    //`);

const parts = [
  head,
  `    const STYLES = ${JSON.stringify(`${src('styles.css')}\n${src('extra.css')}`)};\n`,
  src('strings.js'),
  src('logic.js'),
  src('views.js'),
  src('tail.js'),
];

const banner = `/* kira-note Web client — generated from src/ by scripts/build-client.mjs. */\n`;
const output = `${banner}${parts.join('\n')}`;
fs.writeFileSync(path.join(root, 'lib', 'client.js'), output);
process.stdout.write(`built lib/client.js (${output.length} chars)\n`);
