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
    ['f-mailer', 'mailer-hint'],
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
  assert.equal(count(html.match(/<table id="result-table"[\s\S]*?<\/table>/)[0], /<th scope="col">/g), 8);
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

// ---- Step 3 results map
test('step 3 heading is "Your results" and the step bar says Results', () => {
  assert.match(html, /<h2 [^>]*id="step-3-title"[^>]*>Your results<\/h2>/);
  assert.match(html, /<li data-step="3"[^>]*>\s*<button[^>]*><span>3<\/span> Results<\/button>/);
});

test('List and Map are toggle buttons in a group labelled View', () => {
  for (const [id, pressed] of [['view-list', 'true'], ['view-map-results', 'false']]) {
    const tag = tagWithId(html, id);
    assert.match(tag, /^<button type="button"/, id);
    assert.match(tag, new RegExp(`aria-pressed="${pressed}"`), id);
  }
  assert.match(html, /<div class="toggle" role="group" aria-label="View">\s*<button type="button" id="view-list"/);
});

test('map status and in-view count each have exactly one live role', () => {
  for (const id of ['map-status', 'in-view-count']) assert.equal(liveRoles(tagWithId(html, id)), 1, id);
});

test('results map takes focus, has a role for its label, and points to the keys hint', () => {
  const tag = tagWithId(html, 'results-map');
  assert.match(tag, /tabindex="0"/);
  assert.match(tag, /aria-describedby="map-keys-hint"/);
  assert.match(tag, /aria-label="Map of matching hams"/);
  assert.match(tag, /role="region"/);
  assert.match(html, /<p id="map-keys-hint" class="hint">Use the arrow keys to move the map and \+ or − to zoom\.<\/p>/);
  assert.match(tagWithId(html, 'results-map-panel'), /\bhidden\b/);
});

test('in-view table has a caption and five column scopes', () => {
  const table = html.match(/<table id="in-view-table"[\s\S]*?<\/table>/)?.[0] ?? '';
  assert.match(table, /<caption[^>]*>Hams in this map view<\/caption>/);
  assert.deepEqual(attrValues(table, /<th scope="col">([^<]+)<\/th>/g), ['Call', 'Name', 'Class', 'City', 'Look up']);
});

// tests/repo-hygiene.test.js checks that no club call sign appears in any file.

test('public/CLAUDE.md states the accessibility rule and README points to it', () => {
  const rules = readFileSync(new URL('../../public/CLAUDE.md', import.meta.url), 'utf8');
  assert.match(rules, /WCAG 2\.2 (level )?AA/);
  assert.match(rules, /docs\/accessibility\.md/);
  assert.match(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), /public\/CLAUDE\.md/);
});

test('footer links to the repo and to a new GitHub issue', () => {
  const footer = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)?.[1] ?? '';
  assert.match(footer, /<a href="https:\/\/github\.com\/[\w-]+\/[\w-]+">[^<]+<\/a>/);
  assert.match(footer, /<a href="https:\/\/github\.com\/[\w-]+\/[\w-]+\/issues\/new">Report a problem<\/a>/);
});

test('each step in the step bar is a real button so keyboard users can jump to it', () => {
  for (const n of [1, 2, 3]) {
    assert.match(html, new RegExp(`<li data-step="${n}"[^>]*>\\s*<button type="button" class="step-link"`));
  }
});

// ---- Lookup page (public/lookup.html)
const lookupUrl = new URL('../../public/lookup.html', import.meta.url);
const readLookup = () => readFileSync(lookupUrl, 'utf8');

test('lookup page: skip link, main, labelled h2', () => {
  const lk = readLookup();
  assert.match(lk, /<html lang="en">/);
  assert.match(lk, /<body>\s*<a [^>]*id="skip-link"[^>]*href="#main"/);
  assert.match(lk, /<main [^>]*id="main"[^>]*tabindex="-1"/);
  assert.match(lk, /<section [^>]*aria-labelledby="lookup-title"/);
  assert.match(lk, /<h2 [^>]*id="lookup-title"[^>]*tabindex="-1"/);
  assert.doesNotMatch(lk, /role="application"/);
});

test('lookup page: every control has a label and hints are tied', () => {
  const lk = readLookup();
  const labelled = new Set(attrValues(lk, /<label [^>]*for="([^"]+)"/g));
  const controls = attrValues(lk, /<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g);
  for (const id of ['lookup-by', 'lookup-q', 'lookup-state', 'lookup-county']) assert.ok(controls.includes(id), id);
  for (const id of controls) assert.ok(labelled.has(id), id);
  assert.match(tagWithId(lk, 'lookup-q'), /aria-describedby="[^"]*\blookup-hint\b/);
  assert.match(tagWithId(lk, 'lookup-county'), /role="combobox"/);
  const refs = attrValues(lk, /aria-(?:describedby|labelledby|controls)="([^"]+)"/g).flatMap((v) => v.split(' '));
  for (const ref of refs) assert.match(lk, new RegExp(`id="${ref}"`), ref);
});

test('lookup page: live elements have one live role', () => {
  const lk = readLookup();
  for (const id of ['banner-error', 'lookup-count', 'lookup-county-count']) {
    assert.equal(liveRoles(tagWithId(lk, id)), 1, id);
  }
});

test('lookup page: table has caption, 6 column scopes, labelled scroll box', () => {
  const lk = readLookup();
  assert.match(lk, /<caption id="lookup-caption"/);
  assert.equal(count(lk, /<th scope="col">/g), 6);
  assert.match(lk, /class="table-wrap"[^>]*tabindex="0"[^>]*aria-labelledby="lookup-caption"/);
  assert.match(lk, /class="table-wrap"[^>]*role="region"/);
});

test('both pages have the site nav with aria-current on their own link', () => {
  const nav = (s) => s.match(/<nav [^>]*aria-label="Site"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  assert.match(nav(html), /<a href="\/" aria-current="page">Mailing list<\/a>/);
  assert.match(nav(html), /<a href="\/lookup.html">Lookup<\/a>/);
  const lk = readLookup();
  assert.match(nav(lk), /<a href="\/">Mailing list<\/a>/);
  assert.match(nav(lk), /<a href="\/lookup.html" aria-current="page">Lookup<\/a>/);
});

test('lookup page loads nothing from other hosts', () => {
  const lk = readLookup();
  const external = attrValues(lk, /\b(?:src|href)="(https?:[^"]+)"/g)
    .filter((u) => !u.startsWith('https://github.com/freethewhat/hamlicenselookup'));
  assert.deepEqual(external, []);
});
