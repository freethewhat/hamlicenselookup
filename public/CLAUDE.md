# Web page rules

Every change here must keep the page **WCAG 2.2 level AA** compliant. A change that breaks it is not done.

## How the page is built

- `js/main.js` is the shell. It owns the three steps (areas, filters, results) in `step-areas.js`, `step-filters.js`, `step-results.js`.
- One shared `selection` object (`js/selection.js`) holds the picked areas. The map view (`map-view.js`, Leaflet) and the form view (`form-view.js`) both write to it.
- Modules with no DOM or browser APIs (`selection.js`, `format.js`, `status-format.js`, `saved-selection.js`, and others) are tested under node in `tests/public/`. Put logic in modules like these so it stays testable.
- No dark mode yet. Keep every color as a `:root` token in `css/app.css` so it can be added later.

## Accessibility rules

- **Contrast.** Text at least 4.5:1 against its background (3:1 for large text). Borders, icons, and focus rings that carry meaning at least 3:1. `tests/public/theme.test.js` checks the token pairs. Add any new pair to it.
- **Keyboard.** Everything works with a keyboard alone. Nothing traps focus.
- **Focus.** The focus ring is always visible (slate, 3px) and never hidden behind other things. When the step changes, focus moves to the new step's heading.
- **Labels.** Every control has a visible label. Placeholder text is never the only label. Hints are tied to their field with `aria-describedby`.
- **Target size.** Click and tap targets at least 24×24 px. Buttons and chip remove buttons aim for 44 px.
- **Motion.** Animations and transitions stop under "reduce motion".
- **Color alone.** Never show meaning by color alone. Add text, shape, weight, or an ARIA state.
- **Live messages.** Messages that change (errors, counts, progress) have one live role each, so screen readers say them once.
- **The map.** Map shapes work only with a mouse or touch. The **Form** view is the accessible way to pick the same areas. It must always be able to do everything the map can.
- **Zoom and small screens.** Works at 320 px wide and 400% zoom with no sideways page scroll. Only the results table may scroll inside its own box.

`tests/public/markup.test.js` checks headings, labels, live regions, and the skip link. Keep it passing and extend it when you add markup.

## Required check for every UI or UX change

Any change to `public/` that a visitor can see or use (markup, CSS, page behavior, wording, focus, keyboard) is not done until all of this is done and recorded. "No axe run" is not an accepted result.

1. **axe scan** with axe-core and the tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`, using the method in `docs/accessibility.md` ("How to repeat the audit"). Scan every state the change touches (empty, filled, open lists, errors, no results) at full width and at 320 px. 0 violations. Check each "needs review" item by hand.
2. **Keyboard pass.** Tab through every changed part. Each stop shows the focus ring, the order makes sense, nothing traps focus, and every control works with Enter, Space, or the arrow keys as expected.
3. **Zoom and spacing.** At 320 px wide: no sideways page scroll. With the text spacing override (line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em): nothing cut off.
4. **Tests.** Extend `tests/public/markup.test.js` for new markup and `tests/public/theme.test.js` for new color pairs. `npm test` passes.
5. **Record it.** Add a "Change check" entry at the top of `docs/accessibility.md`: date, tools, the axe table (state and violation count), and the other checks. Say plainly what was not checked.

Do this before you open or update a PR, and include the result in the PR description.
