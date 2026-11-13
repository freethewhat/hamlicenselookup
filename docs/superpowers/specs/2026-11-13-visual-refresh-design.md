# Ham License Finder — Visual Refresh and Accessibility Design

## 1. Intent

The app works. The forms, the map, the filters, and the CSV export all do
their job. The page looks plain and does not feel welcoming. This project
gives it a modern, warm look and makes it meet **WCAG 2.2 level AA**, the
usual web standard for ADA accessibility.

The users are this club and other ham radio clubs anywhere in the US
(see the main design, `2026-11-13-ham-license-finder-design.md`). Many
are not technical. The page should feel friendly the first time someone
opens it, and it should work for people who use a keyboard, a screen
reader, zoom, or a phone.

## 2. Goals

- A new look, chosen from mockups (see section 4).
- Meet WCAG 2.2 AA on every screen and state of the page: all three
  steps, banners, errors, empty and loading states.
- Use modern CSS where it helps (see section 6).
- Keep the page fast and simple: plain JavaScript modules, no build step.

## 3. Non-goals and anti-goals

**Non-goals**
- No change to what the app does: same three steps, same filters, same
  CSV, same API. Server code changes only where the look needs it (for
  example, serving font files).
- No dark mode for now. The owner decided this. Keep colors in CSS
  custom properties so dark mode can be added later.
- No new pages, no logo design work beyond the small mark in section 4.

**Anti-goals (a failure even if it looks nice)**
- Any feature that worked before stops working, or any existing test
  breaks without a matching reason.
- A framework, bundler, or build step gets added.
- The page loads anything from a third-party server other than the
  OpenStreetMap tiles it already uses. No Google Fonts, no CDNs. Visitor
  data must not go to Google or anyone else.
- The site uses the club's call sign or club name anywhere. The site is
  for any club. The colors come from the club's site, but nothing else
  does.
- The map gets so big or so slow on phones that step 1 is hard to use.

## 4. The look (decided with mockups)

Mockups: `.superpowers/brainstorm/1460107-1794608850/content/`
(`look-options.html`, then `look-b-with-a-colors.html`, version 2).

The owner picked **layout B ("Clean Cards") with the colors from look A
("Big Sky"), using the simple top (version 2)**.

**Colors** (taken from the club's website, then a warm cream and slate
added from look A):

| Token | Value | Use |
|---|---|---|
| background | `#faf7f2` (cream) | page background |
| surface | `#ffffff` | cards |
| ink | `#111111` | body text |
| slate | `#2b3a4a` | headings, title, active step, focus ring |
| muted | `#555555` / `#666666` | hints and secondary text |
| red | `#ca2017` | main buttons, picked map shapes, accents |
| red-soft | `#fdecea` with text `#8f1610` | chips for picked areas |
| line | `#ddd5c6` | borders, empty part of the step bar |

Warning, error, info, and success banners keep their meaning; the
builder picks matching warm tints.

**Fonts.** Playfair Display (bold) for the site title only. Card and
step headings use Lato 900 in slate, as in the chosen mockup (version 2).
Lato for everything else. Both are what the club site uses. Both are
served from our own server (see section 7).

**Layout.**
- Top: a small square mark (slate square with a red dot) and the title
  "Ham License Finder" in Playfair Display. No big photo or mountain band.
- Under it: a thin three-part progress bar labeled Areas, Filters,
  List + export. The current step is slate; the others are light.
- Each step sits in one white card with rounded corners (about 16px) and
  a soft shadow. Each card starts with a friendly heading, for example
  "Where should we look?" for step 1.
- Picked areas show as soft red pill chips with a remove button.
- The main button on each step is a red pill. Back buttons are quiet
  secondary buttons.
- Picked map shapes use the red; unpicked shapes use a thin slate
  outline.
- Footer stays: data date and credits, in muted text.

**Builder's call:** exact spacing, shadow, sizes, the exact heading
wording for steps 2 and 3, and the small details of each control. Keep
to the mockup's feel.

## 5. Accessibility (WCAG 2.2 AA)

Standard: WCAG 2.2 level AA. The builder checks every item below, plus
anything else an automated check (axe) or a manual keyboard and
screen-reader pass finds.

Problems found in the current page, and what to do:

1. **Focus is lost when the step changes.** `goToStep` in
   `public/js/main.js` hides the section that holds the focused button,
   so focus falls to the page body. Move focus to the new step's heading
   (with `tabindex="-1"`) after each step change. Screen readers then
   hear where they are.
2. **Step 1 has no visible heading.** Steps use `aria-label` only. Give
   every step a real `<h2>` and point the section at it with
   `aria-labelledby`.
3. **The focus ring fails contrast.** Amber `#f0a500` on white is about
   2:1. Focus rings need at least 3:1. Use a slate ring (`#2b3a4a`,
   3px, offset 2px). Make sure no sticky element covers a focused
   control (WCAG 2.2, 2.4.11).
4. **The map traps screen readers.** `role="application"` on `#map`
   changes how screen readers read keys, and the shapes cannot be
   reached by keyboard (canvas drawing). Remove `role="application"`.
   Keep a clear label. The Form view is the keyboard and screen-reader
   way to pick the same areas. Add a short visible hint near the map,
   such as "Using a keyboard or screen reader? Switch to Form." This is
   allowed by WCAG when the other way does the same job, which it does.
   Leaflet's own zoom buttons must stay reachable and visible on focus.
5. **Hints are not tied to their fields.** Link each `.hint` to its
   field with `aria-describedby` (county search, ZIP text, state picker,
   the date field).
6. **"Next" is disabled with no reason given.** Show a hint near the
   button, such as "Pick at least one area to continue", tied to it with
   `aria-describedby`, while it is disabled.
7. **The update progress bar has no name.** Give the `<progress>` an
   accessible name (for example, `aria-label="Data update progress"`).
8. **The results table has no caption.** Add a caption (it may be
   visually hidden) and `scope="col"` on header cells.
9. **The county picker uses `<datalist>`.** Several screen readers and
   mobile browsers handle it poorly. Replace it with an accessible
   combobox (the ARIA 1.2 combobox pattern: text input, listbox popup,
   arrow keys, Enter, Escape, a live count of matches) that keeps the
   same matching rules as `matchCounties`. Put the filtering logic in a
   pure function and test it in `tests/public/`. (My call: plan it from
   the start, not as a maybe.)
10. **No skip link.** Add a "Skip to main content" link that shows on
    focus.
11. **Messages that change need to be announced.** Keep `role="alert"`
    on the error banner and `role="status"` on result counts and ZIP
    rejection text. Check that each one speaks once, not twice. (My call:
  if no real screen reader can be run, check the live regions and names
  in the browser's accessibility tree instead, and say so in
  `docs/accessibility.md`.)

Rules for everything new:
- Text contrast at least 4.5:1 (3:1 for large text). Borders and icons
  that carry meaning, and focus rings, at least 3:1. Checked values:
  slate on cream about 10.9:1; red on cream about 5.3:1; `#666` on cream
  about 5.4:1. Check every new pair, including chip and banner colors.
- Nothing is shown by color alone. The active step also has bold text
  and `aria-current`; picked map shapes also have a thicker outline.
- Click and tap targets at least 24×24 px (WCAG 2.2, 2.5.8). Aim for
  44 px on buttons and chip remove buttons.
- Works at 400% zoom and at 320 px wide with no sideways scrolling,
  except the results table, which may scroll inside its own box.
- Text spacing changes (WCAG 1.4.12) do not cut off text.
- Animations and transitions turn off when the visitor sets "reduce
  motion" (`prefers-reduced-motion`).
- Every control has a visible label. Placeholder text is never the only
  label.

**How to check (one time, decided by the owner):** run axe on each step
and state with zero violations; tab through the whole flow by keyboard;
read the flow once with a screen reader (Orca on Linux, or NVDA/VoiceOver
if available); check at 320 px width and 200%/400% zoom. Record the
results in `docs/accessibility.md`. Do **not** add Playwright, axe, or
any browser test to the project's dependencies; use tools outside the
repo for this audit. A permanent automated check may come later.

**Keep it compliant (decided by the owner):** add an `AGENTS.md` at the
repo root (there is none today). It must say, in plain words, that every
change to the web page must keep it WCAG 2.2 AA compliant, list the
rules above in short form (contrast, keyboard, focus, labels, target
size, reduce motion, no color-only meaning, Form view as the map's
accessible alternative), point to `docs/accessibility.md` for how to
check, and note the "no build step, no third-party requests" rules from
section 7. Add a one-line pointer to it in the README's Contributing
section.

## 6. Modern CSS

The owner wants newer techniques. Use them where they make the page
better, not for show. Ideas the builder may use:

- CSS custom properties for all colors, sizes, and radii (ready for a
  future dark mode).
- `:has()` to style a field when its checkbox is on, or a card when it
  has an error.
- Container queries so cards and the toolbar fit their space.
- `color-mix()` for hover and soft tints from the main colors.
- The View Transitions API for smooth step changes, only when the
  browser has it, and never when reduce motion is on. Focus handling
  from section 5 must still work.
- `clamp()` for type sizes that grow with the screen.
- Logical properties and `gap` instead of margin tricks.

All of these must fall back to a plain, working page in browsers that
lack them. The page must work in the last two versions of Chrome,
Firefox, Safari, and Edge.

## 7. Constraints

- Plain HTML, CSS, and JavaScript modules in `public/`. No build step.
- **Fonts served locally.** My call: add the `@fontsource/lato` and
  `@fontsource/playfair-display` npm packages and serve their files from
  `node_modules`, the same way Leaflet is served in
  `src/server/app.js` (`/vendor/...`). Load only the weights used
  (about Lato 400, 700, 900 and Playfair Display 700, Latin subset).
  Use `font-display: swap`. The current Content Security Policy
  (`default-src 'self'`) already allows same-origin fonts.
- Keep all existing element IDs that the JavaScript and tests use, or
  update the JavaScript and tests together.
- `npm test` and `npm run lint` must pass. Add tests for new pure logic
  (for example, any new combobox matching) the way `tests/public/` does.
- Update the README if anything about running the app changes.

## 8. Left to the builder

- Exact spacing, sizes, shadows, and the small details of each control.
- Heading text for steps 2 and 3, in the same friendly voice as
  "Where should we look?"
- Which modern CSS features to use from section 6.
- Map shape styles, within the colors in section 4.
- How the step bar, banners, and table look, within the look in
  section 4.
