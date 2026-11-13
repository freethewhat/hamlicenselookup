// Static checks on public/index.html for the WCAG 2.2 AA rules in public/CLAUDE.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

const attrValues = (s, re) => [...s.matchAll(re)].map((m) => m[1]);
const count = (s, re) => [...s.matchAll(re)].length;
// The opening tag of the element with this id.
const tagWithId = (s, id) => s.match(new RegExp(`<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
const liveRoles = (tag) => count(tag, /role="(?:alert|status|log)"|aria-live="/g);

test('no role=application anywhere', () => assert.doesNotMatch(html, /role="application"/));

test('skip link is the first thing in body and targets main', () => {
  assert.match(html, /<body>\s*<a [^>]*id="skip-link"[^>]*href="#main"/);
  assert.match(html, /<main [^>]*id="main"[^>]*tabindex="-1"/); // so the skip link moves keyboard focus, not just the scroll
});

test('each step section is labelled by a real h2 with tabindex -1', () => {
  for (const n of [1, 2, 3]) {
    assert.match(html, new RegExp(`<section id="step-${n}"[^>]*aria-labelledby="step-${n}-title"`));
    assert.match(html, new RegExp(`<h2 [^>]*id="step-${n}-title"[^>]*tabindex="-1"`));
  }
});

test('every aria-describedby, aria-labelledby, and aria-controls id exists', () => {
  const refs = attrValues(html, /aria-(?:describedby|labelledby|controls)="([^"]+)"/g).flatMap((v) => v.split(' '));
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.match(html, new RegExp(`id="${ref}"`), ref);
});

test('hints are tied to their fields', () => {
  for (const [field, hint] of [
    ['state-add', 'state-hint'],
    ['county-search', 'county-hint'],
    ['zip-text', 'zip-hint'],
    ['f-since', 'since-hint'],
    ['next-1', 'next-1-hint'],
  ]) {
    assert.match(tagWithId(html, field), new RegExp(`aria-describedby="[^"]*\\b${hint}\\b`), field);
  }
});

test('the map points keyboard and screen-reader users to the Form view', () => {
  assert.match(html, /id="map-a11y-hint"[^>]*>[^<]*Form/);
  assert.match(tagWithId(html, 'map'), /aria-describedby="[^"]*map-a11y-hint/);
});

test('the map has a role, so its aria-label is allowed (axe aria-prohibited-attr)', () => {
  assert.match(tagWithId(html, 'map'), /role="region"/);
});

test('county input is an ARIA combobox and there is no datalist', () => {
  assert.match(tagWithId(html, 'county-search'), /role="combobox"/);
  assert.match(html, /<ul [^>]*id="county-listbox"[^>]*role="listbox"/);
  assert.doesNotMatch(html, /<datalist/);
});

test('results table has a caption, column scopes, and a focusable labelled scroll box', () => {
  assert.match(html, /<caption id="result-caption"/);
  assert.equal(count(html, /<th scope="col">/g), 8);
  assert.match(html, /class="table-wrap"[^>]*tabindex="0"[^>]*aria-labelledby="result-caption"/);
  assert.match(html, /class="table-wrap"[^>]*role="region"/);
});

test('each live element has exactly one live role', () => {
  for (const id of ['banner-error', 'result-count', 'zip-rejected', 'zip-covered', 'county-count']) {
    assert.equal(liveRoles(tagWithId(html, id)), 1, id);
  }
});

test('every form control has a <label for>', () => {
  const labelled = new Set(attrValues(html, /<label [^>]*for="([^"]+)"/g));
  const controls = attrValues(html, /<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g);
  assert.ok(controls.length > 0);
  for (const id of controls) assert.ok(labelled.has(id) || new RegExp(`<label[^>]*>\\s*<input[^>]*id="${id}"`).test(html), id);
});

// tests/repo-hygiene.test.js checks that no club call sign appears in any file.

test('public/CLAUDE.md states the accessibility rule and README points to it', () => {
  const rules = readFileSync(new URL('../../public/CLAUDE.md', import.meta.url), 'utf8');
  assert.match(rules, /WCAG 2\.2 (level )?AA/);
  assert.match(rules, /docs\/accessibility\.md/);
  assert.match(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), /public\/CLAUDE\.md/);
});
