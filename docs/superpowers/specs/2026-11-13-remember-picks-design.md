# Remember picks between visits: design

Issue: #2. Size: a small change.

## Why

A user searches the same area again and again. Today a reload or a closed tab loses the step 1 picks, so the user must pick them all again. After this change, the app shows the last picks when it opens.

## Goals

- Save the picked states, ZIPs, and counties in this browser.
- Show them again on the next visit: in the state chips, on the map, in the form view, and in the selected list.

## Non-goals

- Step 2 filters. They can be a later issue.
- Saving the view (map or form) or the map mode (ZIP or county).
- Sharing picks between browsers or devices. The app has no accounts.

## Anti-goals

- Bad or blocked storage must never break the page. If anything goes wrong, the page starts empty.
- No server change, and no new third-party loads.

## Approaches

| Option | Survives close and reopen? | Trade-off |
|---|---|---|
| `localStorage` (picked) | Yes | Stays in this browser until cleared. No server change. |
| `sessionStorage` | No | Cleared when the tab closes. Fails the story. |
| Cookie | Yes | Sent to the server on every request for no reason. Small size limit. |

The issue picked `localStorage`. The other two options do not fit.

## Decided

- **Key:** `hamfinder.selection.v1`. The value is JSON: `{ "states": ["MT"], "items": [{ "type": "zip", "id": "59801", "label": "59801" }] }`. If the format changes later, a new key name (`v2`) makes the app ignore old data.
- **New module** `public/js/saved-selection.js` with `load(storage)` and `save(storage, data)`. Every storage call is wrapped in `try/catch`. `load` checks the shape and returns `{ states: [], items: [] }` for missing, bad, or blocked data. The storage object is passed in, so node tests can use a fake.
- **`selection.restore(items)`** in `public/js/selection.js`. It replaces the contents and fires one change event, not one per item. It skips items that do not have a valid `type` and `id`.
- **Start-up in `step-areas.js`:** load the saved data. Keep only the saved states that are in `getStates()`. Load their data. Then restore the items.
- **Save** on `selection.onChange` and every time the picked states change.
- **"Clear all"** empties the selection. The save on change then writes no items. The picked states stay, the same as today.
- **Removing a state** keeps its ZIPs and counties in the list, the same as today (decision from the user). Those picks stay saved. After a reload they show in the list but not on the map.

## Left to the builder

- The exact checks that `load` uses to decide if data is valid.
- Where the start-up restore goes in `initAreas`. It must not save an empty state before the restore finishes.
- Unit tests in `tests/public/`: load, save, bad JSON, blocked storage, and `restore()`.
- Add the "reload keeps picks" check to `docs/accessibility.md` if focus or live messages change. The design expects no change to them.
