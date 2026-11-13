// Checks the color tokens in app.css against the spec and WCAG 2.2 AA contrast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio } from '../helpers/contrast.js';

const css = readFileSync(new URL('../../public/css/app.css', import.meta.url), 'utf8');
const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
const tokens = Object.fromEntries([...root.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]));

test('contrastRatio matches known values', () => {
  assert.ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio('#ca2017', '#ffffff') - 5.63) < 0.05);
});

const want = {
  '--bg': '#faf7f2', '--surface': '#ffffff', '--ink': '#111111', '--slate': '#2b3a4a', '--muted': '#666666',
  '--red': '#ca2017', '--red-soft': '#fdecea', '--red-ink': '#8f1610', '--line': '#ddd5c6',
};
test('tokens have the spec values', () => {
  for (const [k, v] of Object.entries(want)) assert.equal(tokens[k], v, k);
});

const pairs = [
  ['--ink', '--bg', 4.5], ['--ink', '--surface', 4.5], ['--slate', '--bg', 4.5], ['--slate', '--surface', 4.5],
  ['--muted', '--bg', 4.5], ['--muted', '--surface', 4.5], ['--red', '--bg', 4.5], ['--red', '--surface', 4.5],
  ['--surface', '--red', 4.5], // white text on red buttons
  ['--red-ink', '--red-soft', 4.5], // chip text
  ['--slate', '--surface', 3], ['--slate', '--bg', 3], // focus ring
  ['--line-strong', '--surface', 3], ['--line-strong', '--bg', 3], // input and button borders
];
test('every text and focus pair meets WCAG AA', () => {
  for (const [fg, bg, min] of pairs) {
    const r = contrastRatio(tokens[fg], tokens[bg]);
    assert.ok(r >= min, `${fg} on ${bg} is ${r.toFixed(2)}`);
  }
});

test('every banner tint token keeps ink at 4.5:1', () => {
  const tints = Object.keys(tokens).filter((k) => k.startsWith('--tint-'));
  assert.ok(tints.length >= 4, 'warn, error, info, ok tints');
  for (const k of tints) assert.ok(contrastRatio(tokens['--ink'], tokens[k]) >= 4.5, k);
});

test('button colors change at once, so no half-faded state fails contrast', () => {
  const buttonRule = css.match(/\nbutton\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.doesNotMatch(buttonRule, /transition:[^;]*(background|color)/);
});

test('no third-party URLs in the stylesheet', () => assert.doesNotMatch(css, /url\(\s*['"]?https?:/));
test('fonts come from our own server', () => {
  assert.match(css, /@font-face\s*\{[^}]*\/vendor\/fonts\/lato\/files\/lato-latin-400-normal\.woff2/);
  assert.match(css, /@font-face\s*\{[^}]*\/vendor\/fonts\/playfair-display\/files\/playfair-display-latin-700-normal\.woff2/);
});
test('motion is turned off for reduce-motion users', () => assert.match(css, /@media \(prefers-reduced-motion: reduce\)/));
test('focus ring uses the slate token', () => assert.match(css, /:focus-visible[^{]*\{[^}]*outline:[^;]*var\(--slate\)/));
