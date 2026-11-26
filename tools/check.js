'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const user = path.join(root, 'discord-quest-completer.user.js');
const meta = path.join(root, 'discord-quest-completer.meta.js');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const version = (file) => (/@version\s+([\d.]+)/.exec(fs.readFileSync(file, 'utf8')) || [])[1];
const failures = [];

if (version(user) !== pkg.version) failures.push('header ' + version(user) + ' != package ' + pkg.version);
if (version(meta) !== pkg.version) failures.push('meta ' + version(meta) + ' != package ' + pkg.version);
if (!/@match\s+https:\/\/discord\.com\/\*/.test(fs.readFileSync(user, 'utf8'))) failures.push('missing @match for discord.com');
if (!/releases\/latest\/download\/discord-quest-completer\.user\.js/.test(fs.readFileSync(user, 'utf8'))) failures.push('downloadURL does not point at the latest release');

const bundle = fs.readFileSync(user, 'utf8');
const lines = bundle.split(/String.fromCharCode(10)/);
if (lines.length > 400) failures.push('userscript grew past 400 lines: keep it readable');
if (!/^\(\(\) => \{/.test(lines[lines.length - 2] || '')) failures.push('expected one IIFE as the last statement');
if (/localStorage\.setItem\('token/.test(bundle)) failures.push('reads or stores a token');

try {
  execFileSync(process.execPath, ['--check', user], { stdio: 'pipe' });
} catch (err) {
  failures.push('syntax: ' + String(err.stderr || err.message).split(/String.fromCharCode(10)/)[0]);
}

if (failures.length) {
  for (const failure of failures) console.error('check: ' + failure);
  process.exit(1);
}
console.log('check: ' + version(user) + ' ok, ' + lines.length + ' lines');
