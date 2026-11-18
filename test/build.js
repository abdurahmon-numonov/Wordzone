/* v2.46: the page loads bundles built from the source files. This fails if a source changed after the last
   `node tools/build.js`, or if index.html / sw.js point at a different version than the app. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { BUNDLES, header } = require('../tools/build.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

for (const [name, files] of Object.entries(BUNDLES)) {
  assert(fs.existsSync(path.join(root, name)), name + ' exists');
  assert.equal(read(name).split('\n')[0] + '\n', header(files), name + ' is up to date: run `node tools/build.js`');
}
const all = Object.values(BUNDLES).flat();
const scripts = fs.readdirSync(root).filter(f => /\.js$/.test(f) && !/\.min\.js$/.test(f) && f !== 'sw.js');
for (const f of scripts) assert(all.includes(f), f + ' is in a bundle');
const styles = fs.readdirSync(root).filter(f => /\.css$/.test(f) && !/\.min\.css$/.test(f));
for (const f of styles) assert(all.includes(f), f + ' is in a bundle');

const version = /var VERSION = '([\d.]+)'/.exec(read('i18n.js'))[1];
const html = read('index.html');
assert(html.includes('app.min.css?v=' + version) && html.includes('core.min.js?v=' + version), 'index.html loads this version of the bundles');
assert(!/<script[^>]+src="(?!core\.min\.js)[a-z0-9-]+\.js/.test(html), 'no separate app scripts left in index.html');
assert.equal(/const V = '([\d.]+)'/.exec(read('sw.js'))[1], version, 'the service worker caches this version');
assert(/arcade\.min\.js/.test(read('app.js')), 'app.js loads the arcade bundle on demand');
console.log('✓ Build: bundles match their sources, index.html and the service worker use version ' + version);
