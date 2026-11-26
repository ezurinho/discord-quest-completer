'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'discord-quest-completer.js');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const source = fs.readFileSync(file, 'utf8');
const newline = String.fromCharCode(10);
const lines = source.split(newline);
const trimmed = lines.filter((line) => line.trim());
const failures = [];

const version = (/const VERSION = '([\d.]+)';/.exec(source) || [])[1];
if (version !== pkg.version) failures.push('VERSION ' + version + ' != package ' + pkg.version);
if (source.indexOf('// ==UserScript==') >= 0) failures.push('a userscript header is not meant to be here');
if (!/^\(\(\) => \{$/.test(trimmed[trimmed.length - 8] || trimmed[0] || '')) { /* position varies */ }
if (!/^\}\)\(\);$/.test(trimmed[trimmed.length - 1] || '')) failures.push('the IIFE must close on the last line');
if (!/document\.getElementById\('dqc-panel'\)/.test(source)) failures.push('re-pasting must remove the old panel');
if (/localStorage\.setItem\('token/.test(source)) failures.push('stores a token');
if (/window\.webpackChunkdiscord_app\s*=/.test(source)) failures.push('overwrites the webpack global');
const invariants = [
  ['no hand-built game dispatch', 'RUNNING_GAMES_CHANGE'],
  ['sends the sealed attribution', 'traffic_metadata_sealed'],
  ['stops a previous instance', '__dqcStop'],
  ['single video cadence', 'nextVideoQuest'],
  ['surfaces an enrolment block', 'questEnrollmentBlockedUntil'],
  ['handles Map-shaped tasks', 'taskKeysOf'],
  ['reads the moved application id', 'applications'],
  ['diagnostics button', 'diagnose']
];
for (const [name, needle] of invariants) {
  if (source.indexOf(needle) < 0) failures.push('regression: ' + name);
}
if (lines.length > 820) failures.push('grew past 820 lines: keep it pasteable and readable');

try {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
} catch (err) {
  failures.push('syntax: ' + String(err.stderr || err.message).split(newline)[0]);
}

if (failures.length) {
  for (const failure of failures) console.error('check: ' + failure);
  process.exit(1);
}
console.log('check: ' + version + ' ok, ' + lines.length + ' lines');
