# Accessibility audit

The web page must meet **WCAG 2.2 level AA**. See [public/CLAUDE.md](../public/CLAUDE.md) for the rules every change must follow.

## Latest audit: 2026-11-13

Done after the visual refresh (`docs/superpowers/specs/2026-11-13-visual-refresh-design.md`).

**Result: no known WCAG 2.2 AA failures.**

### Tools

- axe-core 4.10.2, rule tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`.
- Chromium driven by Playwright (the Playwright MCP browser). The audit tools were kept outside this repo. Nothing was added to `package.json`.
- The app ran locally with the full US data set (`AUTO_UPDATE=0`).
- No screen reader was installed (no Orca or NVDA on the machine). The screen-reader check used the browser's accessibility tree (Playwright `ariaSnapshot`) plus a watcher on every live region. A real screen-reader pass is still worth doing; see "Still to do".

### Automated scan (axe)

Every state below had **0 violations**:

| State | Violations |
|---|---|
| Step 1, nothing picked | 0 |
| Step 1, map, by ZIP, areas picked | 0 |
| Step 1, map, by county | 0 |
| Step 1, form view, county list open, rejection message shown | 0 |
| Step 2, "First license only" on | 0 |
| Step 3, results table | 0 |
| Step 3, results table at 320 px wide | 0 |
| Step 3, no results | 0 |
| Error banner shown (search returns an error) | 0 |
| Update banner shown (update in progress) | 0 |

axe left some items as "needs review". They were checked by hand:

- `color-contrast` on map tiles, the Leaflet attribution, and text next to the map: axe cannot read colors over images. The text colors are tokens checked in `tests/public/theme.test.js`. The Leaflet attribution uses Leaflet's own styling on a white, mostly opaque box.
- `color-contrast` on the ✕ remove buttons: they hold a symbol, not text. Their color pair (`--red-ink` on `--red-soft`) is checked in the theme test.

### Problems the audit found and fixed

1. Buttons faded their color for 0.15 s when they became enabled or pressed. During the fade, white text sat on a near-cream background (1.06:1). The fade is removed; only the shadow animates. Test: `button colors change at once` in `tests/public/theme.test.js`.
2. The map box had an `aria-label` but no role, so the label was not allowed (`aria-prohibited-attr`). It is now `role="region"`. Test in `tests/public/markup.test.js`.
3. The results table's scroll box had the same problem. It is now `role="region"`. Test in `tests/public/markup.test.js`.
4. The skip link scrolled to the main area but left keyboard focus behind. `<main>` now has `tabindex="-1"`, so focus moves too. Test in `tests/public/markup.test.js`.

5. (Final review) Removing a chip, a state chip, or using "Clear all" dropped keyboard focus to the top of the page. Focus now goes to the chip in its place, the one before, or the "Selected" heading / state picker. Tested in the browser; helper test `focusIndexAfterRemove` in `tests/public/focus.test.js`.
6. (Final review) The enabled Next button was still described as "Pick at least one area to continue." The description is now removed once an area is picked.
7. (Final review) Clicking or dragging the county list's scrollbar closed the list. The list now keeps focus in the text box on any mouse press inside it.
8. (Final review) The county match count said "20 counties match" when more matched. It now says "Showing 20 of 137 counties. Keep typing to narrow the list." Test: `matchMessage` in `tests/public/county-combobox.test.js`.

### Keyboard

Walked the whole flow with the keyboard only: skip link, state picker, state chip remove, Map/Form and ZIP/county toggles, county combobox (type, Down, Enter, Escape), ZIP text and Add, chip remove, Clear all, Next, filters, Back, table scroll box, Download CSV.

- Focus was always visible: a 3 px slate ring on every control.
- Focus never got stuck.
- After each step change, focus lands on the new step's heading. With the step animation on, it arrives within 50 ms.
- No focused control was covered by another element once the step animation finished.
- Saved picks (issue #2, checked 2026-11-13): after a reload, the state chips and the selected list come back with working ✕ buttons. Focus starts at the top of the page as before. The "ZIP codes covered" live message shows the count once. "Clear all" still moves focus to the "Selected" heading. The restore adds no new controls, focus moves, or live regions.

### Screen reader (accessibility tree)

- Landmarks: banner, main, and one labeled region per step. The map and the table scroll box are also labeled regions.
- Every control has a name. The county box is a `combobox` with a `listbox`. The toggles report `pressed`. Chip buttons say "Remove …".
- The table has a caption and column headers.
- Live messages: the ZIP count, the ZIP/county rejection text, the result count, the county match count, the error banner, and the update banner each have exactly one live role. Each one changed once per action.

### Zoom, small screens, text spacing

- 320 px wide (same as 400% zoom on a 1280 px screen) and 640 px wide (200% zoom): no sideways page scroll on any step. Only the results table scrolls, inside its own box.
- Text spacing override (line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em) at 320 px: nothing cut off and no sideways scroll.

### Motion and older browsers

- With "reduce motion" on: transitions are off, and step changes skip the animation. Focus still moves to the heading.
- With the View Transitions API removed: step changes work, and focus moves to the heading at once.
- `:has()`, container queries, and `color-mix()` each have a plain fallback.

### Target size

All buttons are at least 42 px tall (the Map/Form and ZIP/county toggles). Everything else is at least 44 px. WCAG 2.2 AA needs 24 px. Checkboxes are 20 px, but their labels are clickable and at least 44 px tall.

### Known limits

- **Map shapes work only with a mouse or touch.** They are drawn on a canvas and cannot be reached by keyboard. The **Form** view picks the same areas by keyboard and screen reader, and a hint above the map says so. WCAG allows this because the Form view does the same job.
- Typing very fast (a Tab within one frame of pressing Next) can move focus before the new heading is ready. A person cannot type that fast.

### Still to do

- Do a real screen-reader pass with NVDA (Windows), VoiceOver (Mac or iPhone), or Orca (Linux).
- Check in Firefox and Safari. This audit used Chromium only.

## How to repeat the audit

1. Start the app with data: `LOAD_STATES=MT npm start` (or `docker compose up`).
2. Get axe-core into a folder **outside** this repo (for example `npm pack axe-core` in a temp folder).
3. Load it into the page. The page's Content Security Policy blocks inline and third-party scripts. With Playwright, route a same-origin URL to the file and add it as a script tag:
   ```js
   await page.route('**/__axe.js', (r) => r.fulfill({ path: '/path/to/axe.min.js', contentType: 'application/javascript' }));
   await page.addScriptTag({ url: '/__axe.js' });
   const res = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } }));
   ```
   Or use a browser extension such as axe DevTools.
4. Scan every state in the table above. Wait for step animations to finish before scanning.
5. Do the keyboard, screen-reader, zoom, text-spacing, and reduce-motion checks above.
6. Update this file with the date, the tools, and what you found.
