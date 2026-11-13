# Visual Refresh and Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the page the chosen warm "clean cards" look and make it meet WCAG 2.2 AA, with no change to what the app does.

**Architecture:** Same single Express service and plain-JS page. Fonts come from `@fontsource` npm packages served under `/vendor/fonts/` like Leaflet. The county `<datalist>` becomes an ARIA 1.2 combobox with a pure, tested suggestion function. `app.css` is rewritten around CSS custom properties; static tests guard the markup rules and the color contrast of the tokens.

**Tech Stack:** Node 22, Express 5, Leaflet 1.9.4, plain ES modules, `node --test`, `@fontsource/lato` 5.x, `@fontsource/playfair-display` 5.x.

**Spec:** `docs/superpowers/specs/2026-11-13-visual-refresh-design.md`

## Global Constraints

- WCAG 2.2 level AA on every step and state.
- No framework, bundler, or build step. Plain HTML, CSS, JS modules in `public/`.
- No requests to third-party servers except `https://tile.openstreetmap.org`. No Google Fonts, no CDNs.
- No club call sign or club name anywhere in the site or repo files this plan touches.
- No dark mode. All colors are CSS custom properties on `:root`.
- Do not add Playwright, axe, or any browser test tool to `package.json`. The audit (Task 6) uses tools outside the repo.
- Keep existing element IDs used by JS and tests, or change JS and tests together.
- `npm test` and `npm run lint` pass after every task.
- Must work in the last two versions of Chrome, Firefox, Safari, Edge; modern CSS must fall back to a plain working page.
- Colors: background `#faf7f2`, surface `#ffffff`, ink `#111111`, slate `#2b3a4a`, muted `#555555`/`#666666`, red `#ca2017`, red-soft `#fdecea` with text `#8f1610`, line `#ddd5c6`.
- Fonts: Playfair Display 700 for the site title only; Lato 400/700/900 for everything else (card headings Lato 900, slate). Latin subset, `font-display: swap`.
- Contrast: text ≥ 4.5:1 (large text ≥ 3:1); meaningful borders, icons, focus rings ≥ 3:1.
- Targets ≥ 24×24 px; aim for 44 px on buttons and chip remove buttons.
- Work on branch `visual-refresh`, not `main`.

## Review Focus

1. **Hundreds of picked ZIPs.** A whole county or a pasted list can add 100+ chips. The selected panel must stay usable: it wraps, does not overflow at 320 px, and if it scrolls, the scroll box is focusable and labeled. (Task 4, CSS; checked in Task 6.)
2. **Results table at 320 px and 400% zoom.** The table scrolls inside `.table-wrap`; that box must be keyboard-focusable (`tabindex="0"`, labeled) or axe flags `scrollable-region-focusable`. (Task 3 markup test.)
3. **Same county name in two states** (Ravalli MT / Ravalli ID) and typed text with "County" or ", ST". The combobox must list both with state and keep `matchCounties` rules on Enter. (Task 2 tests.)
4. **Browsers without View Transitions, `:has()`, or container queries.** Step changes and layout must still work; focus still moves to the heading. (Task 4; checked in Task 6 by disabling the API.)
5. **Live messages speaking twice.** Error banner, update banner, result count, ZIP/county rejection, combobox match count: each change is announced once. (Task 3 markup test asserts one live role per element; Task 6 checks.)

---

### Task 1: Branch, commit the docs, and serve local fonts

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src/server/app.js:172-175`
- Test: `tests/server/app.test.js`

**Interfaces:**
- Produces: font files at `/vendor/fonts/lato/files/lato-latin-{400,700,900}-normal.woff2` and `/vendor/fonts/playfair-display/files/playfair-display-latin-700-normal.woff2`, cached like Leaflet (`max-age=86400`).

- [ ] **Step 1: Create the branch and commit spec and plan**

```bash
git switch -c visual-refresh
git add docs/superpowers/specs/2026-11-13-visual-refresh-design.md docs/superpowers/plans/2026-11-13-visual-refresh.md
git commit -m "docs: visual refresh and accessibility design and plan"
```

- [ ] **Step 2: Install the font packages as runtime dependencies**

Run: `npm install @fontsource/lato@^5.3.0 @fontsource/playfair-display@^5.3.0`
Expected: both appear under `dependencies` (not dev; the Docker image runs `npm ci --omit=dev`).

- [ ] **Step 3: Write the failing test** in `tests/server/app.test.js`

```js
test('local font files are served and cached', async () => {
  await withApp(fixture, {}, async (base) => {
    for (const path of [
      '/vendor/fonts/lato/files/lato-latin-400-normal.woff2',
      '/vendor/fonts/lato/files/lato-latin-900-normal.woff2',
      '/vendor/fonts/playfair-display/files/playfair-display-latin-700-normal.woff2',
    ]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('content-type'), 'font/woff2');
      assert.match(res.headers.get('cache-control'), /max-age=86400/);
    }
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test tests/server/app.test.js`
Expected: FAIL, status 404.

- [ ] **Step 5: Serve the packages** in `src/server/app.js` next to the Leaflet line: mount `node_modules/@fontsource/lato` at `/vendor/fonts/lato` and `node_modules/@fontsource/playfair-display` at `/vendor/fonts/playfair-display`, `{ maxAge: '1d' }`. If Express does not set `font/woff2` by itself, set it in `setHeaders`.

- [ ] **Step 6: Run tests and lint**

Run: `npm test && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/server/app.js tests/server/app.test.js
git commit -m "feat: serve Lato and Playfair Display from our own server"
```

---

### Task 2: County combobox

Replaces `<datalist id="county-options">` with an ARIA 1.2 combobox.

**Files:**
- Create: `public/js/county-combobox.js`
- Modify: `public/js/form-view.js` (drop datalist code; wire the combobox)
- Modify: `public/index.html` (replace the `<datalist>` with the combobox markup, so the page works after this task)
- Test: `tests/public/county-combobox.test.js`

**Interfaces:**
- Consumes: `matchCounties(text, counties)` from `public/js/form-view.js` (unchanged).
- Produces:
  - `suggestCounties(text: string, counties: {geoid,name,state}[], limit = 20): {geoid,name,state}[]` — pure, no DOM.
  - `createCountyCombobox({ input: HTMLInputElement, listbox: HTMLUListElement, status: HTMLElement, onPick: (county) => void, onEnterText: (text) => void }): { setCounties(counties): void }`.
  - Markup IDs used by Task 3: `county-search` (input), `county-listbox` (ul), `county-count` (status text).

- [ ] **Step 1: Write the failing tests** in `tests/public/county-combobox.test.js`, using the same `counties` fixture as `tests/public/form-view.test.js` plus `{ geoid: '30029', name: 'Flathead', state: 'MT' }`:

```js
const labels = (t, limit) => suggestCounties(t, counties, limit).map((c) => `${c.name}, ${c.state}`);

test('prefix matches come before substring matches', () =>
  assert.deepEqual(labels('ra'), ['Ravalli, ID', 'Ravalli, MT']));       // sorted by name, then state
test('substring match anywhere in the name', () =>
  assert.deepEqual(labels('head'), ['Flathead, MT']));
test('same name in two states lists both', () =>
  assert.deepEqual(labels('Ravalli'), ['Ravalli, ID', 'Ravalli, MT']));
test('", ST" narrows to that state', () =>
  assert.deepEqual(labels('ravalli, mt'), ['Ravalli, MT']));
test('a trailing County/Parish word is ignored', () => {
  assert.deepEqual(labels('Missoula County'), ['Missoula, MT']);
  assert.deepEqual(labels('acadia parish'), ['Acadia Parish, LA']);
});
test('case and extra spaces do not matter', () =>
  assert.deepEqual(labels('  MISSOULA  '), ['Missoula, MT']));
test('blank text gives no suggestions', () => assert.deepEqual(labels('   '), []));
test('limit caps the list', () => assert.equal(labels('a', 2).length, 2));
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/public/county-combobox.test.js`
Expected: FAIL, cannot find module or `suggestCounties` not exported.

- [ ] **Step 3: Implement `suggestCounties`** in `public/js/county-combobox.js`. Normalize text the same way `matchCounties` does (lowercase, collapse spaces, optional `, st`, strip trailing county/parish/borough). Rank: name starts with text, then name contains text; within each, sort by name then state. Apply `limit` last.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/public/county-combobox.test.js`
Expected: PASS.

- [ ] **Step 5: Implement `createCountyCombobox`** (same file) following the ARIA APG "combobox with listbox popup" pattern:
  - input has `role="combobox"`, `aria-expanded`, `aria-controls="county-listbox"`, `aria-autocomplete="list"`, `aria-activedescendant` pointing at the active option.
  - options are `<li role="option" id="county-opt-<geoid>">Name, ST</li>`, `aria-selected` on the active one; click picks.
  - Keys: Down/Up move the active option (open the list if closed); Enter picks the active option, or calls `onEnterText(input.value)` if none is active; Escape closes the list (second Escape clears the input); Tab closes without picking.
  - `status` text (polite, set once per input change after the list updates): "N counties match" / "No counties match".
  - The list closes on blur unless focus moves into it; never trap focus.
- [ ] **Step 6: Wire it in `form-view.js`**: `onPick` adds the county the way `addCounty` does today; `onEnterText` runs the existing `addCounty()` path (keeps the "Several counties match…" and "No county named…" messages). `setCounties` keeps disabling the input and setting the "Pick a state first" placeholder. Remove the `datalist` code. In `index.html`, replace `list="county-options"` and the `<datalist>` with: the input's combobox attributes, `<ul id="county-listbox" role="listbox" aria-label="Matching counties" hidden></ul>`, and `<span id="county-count" role="status" class="visually-hidden"></span>`. Add a `.visually-hidden` rule to `app.css` if none exists. Check by hand in the browser that picking a county still works.

- [ ] **Step 7: Run tests and lint**

Run: `npm test && npm run lint`
Expected: all pass (existing `form-view.test.js` unchanged).

- [ ] **Step 8: Commit**

```bash
git add public/js/county-combobox.js public/js/form-view.js public/index.html public/css/app.css tests/public/county-combobox.test.js
git commit -m "feat: accessible county combobox replaces datalist"
```

---

### Task 3: Accessible markup and focus handling

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/main.js` (`goToStep`)
- Modify: `public/js/step-areas.js` (Next hint), `public/js/update-banner.js` (progress name)
- Create: `public/js/focus.js`
- Test: `tests/public/markup.test.js`, `tests/public/focus.test.js`

**Interfaces:**
- Consumes: combobox IDs from Task 2.
- Produces:
  - Step headings `#step-1-title`, `#step-2-title`, `#step-3-title` (each `<h2 tabindex="-1">`) that Task 4 styles.
  - `stepHeadingId(n: number): string` in `public/js/focus.js` returning `step-${n}-title`.
  - New IDs: `skip-link`, `main` (on `<main>`), `map-a11y-hint`, `next-1-hint`, `state-hint`, `county-hint`, `zip-hint`, `since-hint`, `result-caption`.

- [ ] **Step 1: Write the failing markup test** `tests/public/markup.test.js`. Read `public/index.html` as text; use small regex helpers (no new dependencies). Assertions:

```js
test('no role=application anywhere', () => assert.doesNotMatch(html, /role="application"/));
test('skip link is the first focusable element and targets main', () => {
  assert.match(html, /<body>\s*<a [^>]*id="skip-link"[^>]*href="#main"/);
  assert.match(html, /<main [^>]*id="main"/);
});
test('each step section is labelled by a real h2 with tabindex -1', () => {
  for (const n of [1, 2, 3]) {
    assert.match(html, new RegExp(`<section id="step-${n}"[^>]*aria-labelledby="step-${n}-title"`));
    assert.match(html, new RegExp(`<h2 [^>]*id="step-${n}-title"[^>]*tabindex="-1"`));
  }
});
test('every aria-describedby and aria-labelledby id exists', () => {
  for (const ref of attrValues(html, /aria-(?:describedby|labelledby|controls)="([^"]+)"/g).flatMap((v) => v.split(' ')))
    assert.match(html, new RegExp(`id="${ref}"`), ref);
});
test('hints are tied to their fields', () => {
  for (const [field, hint] of [['state-add', 'state-hint'], ['county-search', 'county-hint'], ['zip-text', 'zip-hint'], ['f-since', 'since-hint'], ['next-1', 'next-1-hint']])
    assert.match(html, new RegExp(`id="${field}"[^>]*aria-describedby="[^"]*${hint}`), field);
});
test('county input is an ARIA combobox and there is no datalist', () => {
  assert.match(html, /id="county-search"[^>]*role="combobox"/);
  assert.match(html, /<ul [^>]*id="county-listbox"[^>]*role="listbox"/);
  assert.doesNotMatch(html, /<datalist/);
});
test('results table has a caption, column scopes, and a focusable labelled scroll box', () => {
  assert.match(html, /<caption id="result-caption"/);
  assert.equal(count(html, /<th scope="col">/g), 8);
  assert.match(html, /class="table-wrap"[^>]*tabindex="0"[^>]*aria-labelledby="result-caption"/);
});
test('each live element has exactly one live role', () => {
  for (const id of ['banner-error', 'result-count', 'zip-rejected', 'zip-covered', 'county-count'])
    assert.equal(liveRoles(tagWithId(html, id)), 1, id);  // counts role=alert|status and aria-live together
});
test('no placeholder-only fields: every input/select/textarea has a <label for>', () => { /* ids of form controls ⊆ label[for] ids */ });
// (call-sign check lives in tests/repo-hygiene.test.js, with the value encoded)
```

`tests/public/focus.test.js`: `assert.equal(stepHeadingId(2), 'step-2-title')`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/public/markup.test.js tests/public/focus.test.js`
Expected: FAIL on most assertions.

- [ ] **Step 3: Update `public/index.html`** to satisfy the tests. Specifics the tests do not pin:
  - Header: a decorative mark (`<span class="mark" aria-hidden="true">`) plus `<h1>Ham License Finder</h1>`.
  - Step 1 heading text: "Where should we look?". Steps 2 and 3: builder's call, same friendly voice.
  - Map hint `#map-a11y-hint`, visible: "Using a keyboard or screen reader? Switch to Form to pick areas." Map keeps `aria-label="Map of ZIP codes and counties"`.
  - `#next-1-hint`: "Pick at least one area to continue." (shown only while Next is disabled).
  - Update banner text stays `role="status"` only; drop the extra `aria-live` so it speaks once.
- [ ] **Step 4: Update the JS**:
  - `main.js` `goToStep(n)`: after showing the section, `document.getElementById(stepHeadingId(n)).focus()` instead of `window.scrollTo(0, 0)` (focus scrolls it into view).
  - `step-areas.js` `renderSelected`: toggle `#next-1-hint` hidden with `next-1.disabled`.
  - `update-banner.js`: `bar.setAttribute('aria-label', 'Data update progress')`; remove the duplicate `aria-live` on the text.
- [ ] **Step 5: Run tests and lint**

Run: `npm test && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/main.js public/js/step-areas.js public/js/update-banner.js public/js/focus.js tests/public/markup.test.js tests/public/focus.test.js
git commit -m "feat: accessible page structure, labels, and focus on step change"
```

---

### Task 4: New look (CSS, map colors, step transitions)

**Files:**
- Rewrite: `public/css/app.css`
- Modify: `public/index.html` (head: nothing new to load; fonts come from `@font-face` in `app.css`)
- Modify: `public/js/map-view.js:3-4` (`BASE`, `PICKED`)
- Modify: `public/js/main.js` (`goToStep` view transition)
- Create: `tests/helpers/contrast.js`
- Test: `tests/public/theme.test.js`

**Interfaces:**
- Consumes: IDs and headings from Task 3; font URLs from Task 1.
- Produces: `contrastRatio(hexA: string, hexB: string): number` in `tests/helpers/contrast.js` (WCAG relative-luminance formula).

- [ ] **Step 1: Write the failing theme test** `tests/public/theme.test.js`. Parse `--name: #hex;` pairs from the `:root` block of `public/css/app.css`. Required token names and values:

```js
const want = { '--bg': '#faf7f2', '--surface': '#ffffff', '--ink': '#111111', '--slate': '#2b3a4a',
  '--muted': '#666666', '--red': '#ca2017', '--red-soft': '#fdecea', '--red-ink': '#8f1610', '--line': '#ddd5c6' };
test('tokens have the spec values', () => { for (const [k, v] of Object.entries(want)) assert.equal(tokens[k], v, k); });

const pairs = [ // [fg, bg, min]
  ['--ink', '--bg', 4.5], ['--ink', '--surface', 4.5], ['--slate', '--bg', 4.5], ['--slate', '--surface', 4.5],
  ['--muted', '--bg', 4.5], ['--muted', '--surface', 4.5], ['--red', '--bg', 4.5], ['--red', '--surface', 4.5],
  ['--surface', '--red', 4.5],          // white text on red buttons
  ['--red-ink', '--red-soft', 4.5],     // chip text
  ['--slate', '--surface', 3], ['--slate', '--bg', 3],  // focus ring
];
test('every text and focus pair meets WCAG AA', () => {
  for (const [fg, bg, min] of pairs) assert.ok(contrastRatio(tokens[fg], tokens[bg]) >= min, `${fg} on ${bg}`);
});
test('every banner tint token keeps ink at 4.5:1', () => {
  for (const k of Object.keys(tokens).filter((k) => k.startsWith('--tint-'))) assert.ok(contrastRatio(tokens['--ink'], tokens[k]) >= 4.5, k);
});
test('no third-party URLs in the stylesheet', () => assert.doesNotMatch(css, /url\(\s*['"]?https?:/));
test('motion is turned off for reduce-motion users', () => assert.match(css, /@media \(prefers-reduced-motion: reduce\)/));
test('focus ring uses the slate token', () => assert.match(css, /:focus-visible[^{]*\{[^}]*outline:[^;]*var\(--slate\)/));
```

Also a unit test for `contrastRatio`: `contrastRatio('#ffffff', '#000000')` is 21 (±0.01) and `contrastRatio('#ca2017', '#ffffff')` ≈ 5.63 (±0.05).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/public/theme.test.js`
Expected: FAIL (tokens missing).

- [ ] **Step 3: Write `tests/helpers/contrast.js`**, then rewrite `public/css/app.css` to the spec look (section 4). Required pieces:
  - `@font-face` for Lato 400/700/900 and Playfair Display 700, `src: url('/vendor/fonts/…woff2') format('woff2')`, `font-display: swap`; stacks fall back to `Helvetica, Arial, sans-serif` and `Georgia, serif`.
  - Tokens above plus warm `--tint-warn`, `--tint-error`, `--tint-info`, `--tint-ok` for banners.
  - Header: mark (30px slate rounded square with red dot) + title in Playfair 700, slate.
  - Step bar: the existing `ol#step-bar` drawn as three segments (6px bars above labels); active segment and label slate, bold; `aria-current` stays the source of truth (style `[aria-current="step"]`).
  - Each `.step` is a white card, ~16px radius, soft slate-tinted shadow; `h2` Lato 900 slate.
  - Chips: `--red-soft` / `--red-ink` pills; remove button ≥ 44px tall hit area (padding, not visual size).
  - Primary button: red pill, white text; secondary: surface with `--line` border. Disabled state keeps text readable and adds `cursor: not-allowed`.
  - Focus: `outline: 3px solid var(--slate); outline-offset: 2px` on all focusables, including `.table-wrap`, step headings (`h2:focus` may use a subtler ring since it is programmatic), and Leaflet controls.
  - Skip link hidden off-screen until `:focus`.
  - `.selected` list: wraps; if it gets taller than ~12rem, scroll with `max-height` and give `#selected-list` `tabindex="0"` + `aria-label="Selected areas"` (Review Focus 1; add these attributes in `index.html` and extend the markup test's live-role/ID checks if needed).
  - Modern CSS with fallbacks: `color-mix()` for hover tints (declare a plain fallback first), `:has()` to style the "First license only" block when checked, a container query on the step card for the toolbar layout, `clamp()` for h1/h2 sizes.
  - `@media (prefers-reduced-motion: reduce)` sets transitions/animations to none and disables view-transition animation.
  - 320 px wide: no sideways scroll except inside `.table-wrap`.
- [ ] **Step 4: Map colors** in `map-view.js`: `BASE = { color: '#2b3a4a', weight: 1, fillColor: '#2b3a4a', fillOpacity: 0.05 }`, `PICKED = { color: '#ca2017', weight: 3, fillColor: '#ca2017', fillOpacity: 0.35 }` (thicker outline so picked is not color-only).
- [ ] **Step 5: View transition** in `goToStep`: if `document.startViewTransition` exists and `matchMedia('(prefers-reduced-motion: reduce)').matches` is false, wrap the section swap in it; focus the heading after `transition.updateCallbackDone`. Otherwise swap and focus directly.
- [ ] **Step 6: Run tests and lint**

Run: `npm test && npm run lint`
Expected: all pass.

- [ ] **Step 7: Look at it.** Start the app (`npm start` with the full data copied or `LOAD_STATES=MT`), open http://127.0.0.1:3100, and compare against `.superpowers/brainstorm/1460107-1794608850/content/look-b-with-a-colors.html` version 2. Check all three steps at 1280 px and 320 px. Stop the server after.
- [ ] **Step 8: Commit**

```bash
git add public/css/app.css public/index.html public/js/map-view.js public/js/main.js tests/helpers/contrast.js tests/public/theme.test.js
git commit -m "feat: warm clean-card look with local fonts and accessible colors"
```

---

### Task 5: AGENTS.md and README

**Files:**
- Create: `AGENTS.md`
- Modify: `README.md` (Contributing section; Project layout if needed)
- Test: `tests/public/markup.test.js` (extend)

- [ ] **Step 1: Write the failing test** (append to `tests/public/markup.test.js`):

```js
test('AGENTS.md states the accessibility rule and README points to it', () => {
  const agents = readFileSync('AGENTS.md', 'utf8');
  assert.match(agents, /WCAG 2\.2 (level )?AA/);
  assert.match(agents, /docs\/accessibility\.md/);
  assert.match(readFileSync('README.md', 'utf8'), /AGENTS\.md/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/public/markup.test.js`
Expected: FAIL, ENOENT for AGENTS.md.

- [ ] **Step 3: Write `AGENTS.md`** in plain words: every change to the web page must keep it WCAG 2.2 AA compliant; short rules (contrast 4.5:1 text / 3:1 UI and focus, everything works by keyboard, focus visible and moved on step change, every control has a visible label, targets ≥ 24 px, honor reduce motion, never color alone, the Form view is the map's accessible alternative and must stay complete); how to check (`docs/accessibility.md`); project rules (no build step, no framework, no third-party requests except OSM tiles, no dark mode yet, keep colors as `:root` tokens, `npm test` and `npm run lint` pass). No club name or call sign.
- [ ] **Step 4: README**: in Contributing, add "Read [AGENTS.md](AGENTS.md) first. Page changes must stay WCAG 2.2 AA compliant." Mention fonts in Credits (Lato and Playfair Display, SIL Open Font License).
- [ ] **Step 5: Run tests and lint**

Run: `npm test && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md README.md tests/public/markup.test.js
git commit -m "docs: AGENTS.md requires WCAG 2.2 AA for page changes"
```

---

### Task 6: One-time accessibility audit

**Files:**
- Create: `docs/accessibility.md`
- Modify: any `public/` file needed to fix what the audit finds (with a test where the fix is testable by the Task 3/4 static tests)

Tools live outside the repo: install `playwright` and `axe-core` in the session scratchpad directory (or use the Playwright MCP browser), never in this repo's `package.json`.

- [ ] **Step 1: Run the app** with real data (`LOAD_STATES=MT npm start`, or the full data set), in the background; note how to stop it.
- [ ] **Step 2: axe scan** each state with WCAG 2.2 AA tags (`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`): step 1 empty; step 1 with Montana picked, map view, by ZIP and by county, 3 areas picked; step 1 form view with a county rejection message and the combobox open; step 2 with "First license only" on; step 3 with results; step 3 with no results; error banner shown; update banner shown (point at a data dir mid-update or stub `/api/status`).
Expected: zero violations. Fix any, re-run, and commit fixes as `fix(a11y): …`.
- [ ] **Step 3: Keyboard pass**: Tab through the whole flow using only the keyboard: skip link, state picker, view toggles, form view, combobox (Up/Down/Enter/Escape), ZIP add, chips remove, Next/Back, filters, Download CSV. Confirm focus is always visible, never lost, never hidden behind anything, and lands on each step heading.
- [ ] **Step 4: Screen reader pass**: Orca (`orca`) with Firefox if available. If not, inspect the accessibility tree (Playwright `page.accessibility.snapshot()` or browser devtools) and confirm names, roles, `aria-current`, and that each live message changes once. Say which method was used.
- [ ] **Step 5: Zoom and width**: 320 px wide and 200% / 400% zoom at 1280 px; text spacing override (line-height 1.5, paragraph 2em, letter 0.12em, word 0.16em). No sideways page scroll; nothing cut off.
- [ ] **Step 6: Fallback check**: in a page where `document.startViewTransition` is deleted before load, step changes still work and focus still moves.
- [ ] **Step 7: Write `docs/accessibility.md`**: date, standard (WCAG 2.2 AA), tools and versions, each state checked with its result, keyboard / screen reader / zoom / fallback results, known limits (the map shapes are mouse/touch only; the Form view is the equivalent way), and how to repeat the audit.
- [ ] **Step 8: Stop every server and browser started for the audit.** Run `npm test && npm run lint`; both pass.
- [ ] **Step 9: Commit**

```bash
git add docs/accessibility.md
git commit -m "docs: WCAG 2.2 AA audit results"
```
