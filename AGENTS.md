# Notes for people and AI agents changing this project

Read the [README](README.md) first. It explains how to run the app and the tests.

## The web page must stay accessible

Every change to the web page (`public/`) must keep it **WCAG 2.2 level AA** compliant. This is a requirement, not a nice-to-have. A change that breaks it is not done.

The short rules:

- **Contrast.** Text is at least 4.5:1 against its background (3:1 for large text). Borders, icons, and focus rings that carry meaning are at least 3:1. Colors live as tokens on `:root` in `public/css/app.css`. `tests/public/theme.test.js` checks the pairs; add any new pair to it.
- **Keyboard.** Everything works with a keyboard alone. Nothing traps focus.
- **Focus.** The focus ring is always visible (slate, 3px) and never hidden behind other things. When the step changes, focus moves to the new step's heading.
- **Labels.** Every control has a visible label. Placeholder text is never the only label. Hints are tied to their field with `aria-describedby`.
- **Target size.** Click and tap targets are at least 24×24 px. Buttons and chip remove buttons aim for 44 px.
- **Motion.** Animations and transitions stop when the visitor sets "reduce motion".
- **Color alone.** Never show meaning by color alone. Add text, shape, weight, or an ARIA state too.
- **Live messages.** Messages that change (errors, counts, progress) have one live role each, so screen readers say them once.
- **The map.** Map shapes work only with a mouse or touch. The **Form** view is the accessible way to pick the same areas. It must always be able to do everything the map can.
- **Zoom and small screens.** The page works at 320 px wide and at 400% zoom with no sideways page scroll. Only the results table may scroll inside its own box.

`tests/public/markup.test.js` checks the page structure (headings, labels, live regions, skip link). Keep it passing and extend it when you add markup.

**How to check a change:** follow the steps in [docs/accessibility.md](docs/accessibility.md) and update that file with what you checked.

## Project rules

- No framework, bundler, or build step. Plain HTML, CSS, and JavaScript modules in `public/`.
- The page loads nothing from third-party servers except OpenStreetMap map tiles. Fonts are served from our own server (`/vendor/fonts/`). No Google Fonts, no CDNs.
- No dark mode yet. Keep every color as a `:root` token so it can be added later.
- The site is for any ham radio club. Do not put a specific club's name or call sign in it.
- `npm test` and `npm run lint` must pass before you open a pull request.
