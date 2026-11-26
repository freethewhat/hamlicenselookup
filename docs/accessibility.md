# Accessibility audit

The web page must meet **WCAG 2.2 level AA**. See [public/CLAUDE.md](../public/CLAUDE.md) for the rules every change must follow.

## Change check: results map, 2026-11-25

Spec: `docs/superpowers/specs/2026-11-25-results-map-design.md`. Adds a List / Map toggle on step 3, a Leaflet map with count circles and pins, a progress line, and the "Hams in this map view" table.

**Result: no known WCAG 2.2 AA failures** after the fixes below.

Tools: axe-core 4.14.1 (rule tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`) in the Playwright MCP browser (Chromium), loaded by the method in "How to repeat the audit". Full US data (`./data`), with Missoula County, MT already placed on the map. The page's Content Security Policy stayed on. The map error state came from a throwaway local server (not in the repo) that ran `createApp` with a Census fetch that always fails and `mapQueueOptions` `{ maxFailures: 1, pauseMs: 0 }`.

| axe state | 1280 px | 320 px |
|---|---|---|
| Step 3, list view (Missoula County, MT, "First license only" off, 397 hams) | 0 | 0 |
| Map view, preparing ("Preparing map: 0 of 571 hams placed." / 568 at 320 px; Gallatin and Flathead counties, MT) | 0 | 0 |
| Map view, done (Missoula County: "326 of 397 hams are on the map. 71 could not be placed …") | 0 | 0 |
| Map view, done, pin popup open | 0 | 0 |
| Map view, error ("The map service is not answering. Try again later.") | 0 | 0 |
| No results (Petroleum County, MT, "First license only" on) | 0 | 0 |

These are the final scans, after the fixes. The first scan of "map view, done" found 1 `target-size` violation (fix 1).

axe "needs review", checked by hand:

- `color-contrast` on the list and in-view table cells inside the scroll box ("partially obscured"), the same item as earlier audits. Text uses token pairs in `tests/public/theme.test.js`.
- `color-contrast` on the count circle: `--cluster-ink` on `--cluster-fill`, a pair in the theme test.
- `color-contrast` on the map hint, progress line, in-view count, opt-out line, Back, and Download CSV while preparing and in the error state ("overlapped by another element", no element named). `elementsFromPoint` at each of them finds only the element itself and its parents. These were below the fold at 900 px tall, and the flag went away once the map finished. All use theme-test token pairs.
- `color-contrast` on the Leaflet attribution and zoom buttons over tiles, and `label-content-name-mismatch` on the Leaflet zoom buttons (+ / −, named "Zoom in" / "Zoom out") and the popup close button (×, "Close popup"): symbols, not text labels. Same items as the 2026-11-13 audit.

### Problems the check found and fixed

1. **Count circles on top of each other.** At the fitted zoom, the grid clustering split Missoula into 4 circles within 11 px of each other. They covered each other (axe `target-size`, 5 px of free space) and their counts could not be read. Groups closer than one grid cell (60 px) now merge into one circle (`src/map/cluster.js`). Tests: two new cases in `tests/map/cluster.test.js`, one of which checks that no two items in a 3,000-point set are closer than 60 px.
2. **Sideways page scroll at 320 px in map view (311 px).** The hidden call sign in each "Look up" link is `position: absolute`. It escaped the table's scroll box because the box was not positioned. `.table-wrap` now has `position: relative`. Test in `tests/public/theme.test.js`.
3. **Focus lost after a cluster zoom.** Enter or Space on a circle zoomed in, then the circle was redrawn and focus fell to `<body>`. Focus now moves to the map region, which shows its ring, and the next Tab goes to the new circles.
4. **Pin popup cut off at 320 px.** Leaflet's default popup width (300 px) was wider than the 249 px map, so the text was clipped at the map edge. Once that was fixed, the popup could slide under the zoom buttons. The popup width now follows the map width (`popupMaxWidth` in `public/js/map-format.js`, tested in `tests/public/map-format.test.js`), it keeps 46 px from the left edge for the zoom buttons, and long words wrap.
5. **Pin popup closed itself.** When a popup near the map edge panned the map to fit, the pan reloaded the points, and the redraw removed the pin and its popup. While a popup is open, map moves now wait. The view reloads when the popup closes.
6. **Progress line repeated.** The progress line and the in-view count were rewritten on every poll (3 s) and every pan, even with the same words. Some screen readers read a live region again whenever its text is rewritten. They are now written only when the text changes (`setLiveText`, tested in `tests/public/map-format.test.js`).

| Check | Result |
|---|---|
| Keyboard, list view | Heading (focused on arrival), List, Map, table scroll box, Back, Download CSV, footer links. Every stop shows the 3 px slate ring. |
| Keyboard, map view | Enter on Map: `aria-pressed` turns true, focus stays on the button. Tab order: map region, each count circle ("325 hams. Zoom in."), Leaflet + and −, attribution links, in-view table scroll box, each "Look up <call>" link, Back, Download CSV. Arrow keys pan the map (80 px a press), + and − zoom. Enter and Space on a circle zoom in 2 levels with no page scroll, and focus goes to the map (fix 3). Shift+Tab from the map goes back to Map. Nothing traps focus. Enter on Download CSV downloads the file. Space on Back opens step 2 with focus on its heading. Returning to step 3 starts in List view. |
| Pins | Not Tab stops, by design. Pins work only with a mouse or touch, like the step 1 map shapes. The keyboard and screen-reader path is the in-view table, which shows each ham's call, name, class, city, and "Look up" link (the popup shows the same). |
| Target size | Count circles are 32 to 64 px. Pins draw about 18 px across. Below zoom 16, after fix 1, no two map items are closer than 60 px, so a 24 px circle on each pin touches nothing else and pins pass WCAG 2.5.8 by the spacing exception. From zoom 16 up nothing is merged and every address is its own pin, so two pins can sit closer than that. There pins pass by the equivalent-control exception: every ham at every pin in view is in the in-view table with a 24 px "Look up" link. "Look up" links are 24 px tall. The popup close button is 24 × 24 px. |
| Live messages | `map-status` (progress line) and `in-view-count` are one `role="status"` each, and each is written only when its text changes (fix 6). The step 3 count stays its own `role="status"`. Map errors from the server show in the progress line, so they are announced once. A 503 while a data update runs shows the list view's data-loading notice there too, not the error banner. |
| 320 px (400% zoom) | List, map done, map preparing, map error, and no results: no sideways page scroll (after fix 2). Only the tables scroll inside their boxes. The pin popup fits inside the map (fix 4). |
| Text spacing override at 320 px | List view and map view: no sideways scroll, and nothing is clipped in step 3. The pin popup wraps its text inside the map and stays clear of the zoom buttons. |

Known, not fixed here:

- The Download CSV button disables itself while the export runs, so focus falls to `<body>` for that moment (Shift+Tab still lands on Back in Chromium). This was already the case before the map, in List view too.
- While a popup is open, panning does not refresh the in-view table until the popup closes (the trade-off in fix 5).

Not checked: real screen reader (none installed), Firefox, Safari, touch devices. Reduce motion was not toggled; the change adds no CSS animation, and Leaflet's own zoom animation is unchanged from step 1.

## Change check: lookup page and title link, 2026-11-19

Spec: `docs/superpowers/specs/2026-11-18-ham-lookup-design.md`. Adds `public/lookup.html`, a two-link site nav in the header of both pages, and makes the "Ham License Finder" title a link to the home page.

**Result: no known WCAG 2.2 AA failures.**

Tools: axe-core 4.10.2 (rule tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`) in the Playwright MCP browser (Chromium), loaded by the method in "How to repeat the audit". Full US data (`./data`, schema v2). The page's Content Security Policy stayed on.

| axe state | Violations |
|---|---|
| Home, step 1, 1100 px and 320 px (new header) | 0 |
| Lookup, empty | 0 |
| Lookup, call sign results | 0 |
| Lookup, details row open | 0 |
| Lookup, name results | 0 |
| Lookup, city (state field shown) | 0 |
| Lookup, county list open | 0 |
| Lookup, no matches | 0 |
| Lookup, error banner (400) | 0 |
| Lookup, results at 320 px | 0 |

axe "needs review" (color contrast it could not compute), checked by hand: table cells inside the sideways-scrolling box at 320 px; the county hints under the open county list (covered by design); the map items already listed in the 2026-11-13 audit. All of that text uses token pairs in `tests/public/theme.test.js`.

| Check | Result |
|---|---|
| Keyboard (Tab only) | Lookup: skip link, title link, Mailing list, Lookup, Search by, text box, Search, table scroll box, first call sign button. Home: skip link, title link, Mailing list, Lookup, then the step bar as before. Every stop shows the 3 px slate ring. Enter on a call sign opens its details, `aria-expanded` turns true, focus stays on the button, and the next Tab goes to the FCC link. |
| Labels | Every control has a `<label for>`. The text field's label and hint change with "Search by". `tests/public/markup.test.js` checks this. |
| Site nav and title link | `<nav aria-label="Site">`. The current page's link has `aria-current="page"` and a slate underline bar, not color alone. The title link's name is the site name. |
| Target size | Nav links 44 px, title link 37 px, form controls and call sign buttons 44 px. |
| Live messages | `lookup-count` (`role="status"`) and `banner-error` (`role="alert"`), one live role each. |
| 320 px (400% zoom) | No sideways page scroll on either page. Only the results table scrolls in its box. |
| Text spacing override at 320 px | Lookup (call results, county field) and home: no sideways scroll, no cut-off labels, hints, buttons, or headings. |
| Back and Forward | Each search adds a history entry. Back and Forward restore the form and the results. |

Known: after a county is picked, the combobox's live text says "Added <county>." (wording shared with the home page).

Not checked: real screen reader, Firefox, Safari.

## Change check: footer GitHub links, 2026-11-14

Adds two links at the end of the footer: "Source code on GitHub" and "Report a problem" (opens a new GitHub issue).

**Result: no known WCAG 2.2 AA failures.**

Tools: Playwright MCP browser (Chromium) at 320 px wide. No axe run for this change.

| Check | Result |
|---|---|
| Link names | Both links have plain text names. The dot between them is `aria-hidden`. |
| Contrast | Links use `--slate` on `--bg`. That pair is already checked in `tests/public/theme.test.js`. |
| Color alone | Links are underlined. |
| Target size | Each link is 24 px tall (141 and 107 px wide). |
| Focus ring | Links use the global `:focus-visible` slate ring. |
| 320 px (400% zoom) | No sideways scroll. Links fit on one line. |

Not checked: real screen reader, Firefox, Safari.

## Change check: "Prepare for mailer", 2026-11-14

Spec: `docs/superpowers/specs/2026-11-14-prepare-for-mailer-design.md`. Adds one checkbox with a hint on step 2 and an address count on step 3.

**Result: no known WCAG 2.2 AA failures.**

Tools: axe-core 4.10.2 (same rule tags as below) and playwright-core 1.49.1 driving Google Chrome headless, both installed outside this repo. Data: full local data set, Missoula County, MT picked. The page's Content Security Policy stayed on.

| Check | Result |
|---|---|
| axe: step 2, mailer off / on | 0 violations |
| axe: step 3, mailer on | 0 violations |
| axe: step 2 at 320 px, mailer on | 0 violations |
| Name and description | Accessibility tree shows `checkbox "Prepare for mailer"`. The hint is its `aria-describedby`. |
| Keyboard | Tab order: First license only, expired, clubs, **Prepare for mailer**, Back. Space toggles it. No trap. |
| Focus ring | Solid 3 px slate on the checkbox. |
| Target size | Label is 44 px tall. Clicking the label text toggles the box. |
| Live message | Step 3 count stays one `role="status"`. It changes once per search: "396 hams found at 375 addresses". Focus lands on the step 3 heading. |
| Mailer off | Count goes back to "396 hams found". |
| 320 px (400% zoom) | No sideways scroll on step 2 or step 3. The hint wraps inside the viewport. |
| Text spacing at 320 px | No sideways scroll. Label and hint not cut off. |
| Download | `hams-mailer-2026-11-14.csv`, mailer header, 375 rows (matches the address count). |

Not checked: real screen reader, Firefox, Safari (same gaps as the full audit below). Reduce motion was on for the whole run; the change adds no animation.

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

### Step bar and browser history (2026-11-18)

- Each step in the step bar is now a `<button>`. Steps 2 and 3 stay disabled until an area is picked, the same rule as the Next button. The current step keeps `aria-current="step"`.
- Clicking a step, Next, or Back adds a browser history entry. Browser Back and Forward move between steps. If the picked areas were cleared, Back or Forward to step 2 or 3 goes to step 1.
- Checked in Chromium with Playwright: step bar click, Back, Forward, focus moves to the new step's heading. Button targets are 44 px tall. No new colors.

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
   Use the tag list `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`. With the Playwright MCP browser, run this through `browser_run_code_unsafe`.
4. Scan every state in the table above, and every new state your change adds (each panel, open list, error, empty result, and 320 px). Wait for step animations to finish before scanning.
5. Do the keyboard, screen-reader, zoom, text-spacing, and reduce-motion checks above.
6. Update this file with the date, the tools, and what you found.
