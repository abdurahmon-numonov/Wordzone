#!/usr/bin/env node
/* Builds the files the page actually loads from the unchanged source files:
 *   core.min.js    every script the app needs at start, in the same order as before
 *   arcade.min.js  the three big games (Fishing, Café, Defense), loaded when idle or when Games opens
 *   app.min.css    every stylesheet except the fonts (their url()s are relative to vendor/fonts)
 * Each source is minified on its own (esbuild transform: top-level names stay, so the files still talk to each
 * other through the same globals) and joined in order. The first line lists a hash of every source, so
 * test/build.js can tell when a bundle is out of date without needing esbuild.
 * Run after changing any source: node tools/build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const BUNDLES = {
  'core.min.js': ['display.js', 'i18n.js', 'motion.js', 'languages.js', 'grammar.js', 'learning.js', 'writing.js', 'ai-core.js', 'share.js', 'games.js', 'course.js', 'account.js', 'app.js'],
  'arcade.min.js': ['fishing.js', 'cafe.js', 'defense.js'],
  'app.min.css': ['styles.css', 'editorial.css', 'shell.css', 'motion.css', 'composer.css', 'onboarding.css', 'arcade.css', 'cafe.css', 'defense.css', 'themes.css']
};

function loadEsbuild() {
  for (const p of ['esbuild', '/opt/npm-tools/node_modules/esbuild']) { try { return require(p); } catch (e) { /* next */ } }
  return null;
}
function hash(text) { return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12); }
function header(files) { return '/* wordzone bundle · ' + files.map(f => f + ':' + hash(fs.readFileSync(path.join(root, f), 'utf8'))).join(' ') + ' */\n'; }

function build(name, files, esbuild) {
  const css = name.endsWith('.css');
  const parts = files.map(f => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    if (!esbuild) return src; // still one request, just not minified
    return esbuild.transformSync(src, { loader: css ? 'css' : 'js', minify: true, legalComments: 'none', charset: 'utf8'}).code;
  });
  return header(files) + parts.map(p => p.trim()).join(css ? '\n' : ';\n') + '\n';
}

module.exports = { BUNDLES, header, hash };

if (require.main === module) {
  const esbuild = loadEsbuild();
  if (!esbuild) console.warn('esbuild not found: bundles are joined without minifying');
  for (const [name, files] of Object.entries(BUNDLES)) {
    const out = build(name, files, esbuild);
    fs.writeFileSync(path.join(root, name), out);
    const raw = files.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
    console.log(name.padEnd(14), files.length + ' files', Math.round(raw / 1024) + ' KB →', Math.round(out.length / 1024) + ' KB');
  }
}
