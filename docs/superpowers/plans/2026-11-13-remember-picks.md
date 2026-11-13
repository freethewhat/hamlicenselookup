# Remember Picks Between Visits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save the step 1 picks (states, ZIPs, counties) in `localStorage` and put them back when the app opens.

**Architecture:** A small pure module `saved-selection.js` reads and writes one JSON key through a storage object that is passed in. `selection.restore()` refills the shared selection with one change event. `step-areas.js` restores on start and saves on every change.

**Tech Stack:** Plain browser ES modules, `node --test`, ESLint. No build step.

**Spec:** `docs/superpowers/specs/2026-11-13-remember-picks-design.md`

## Global Constraints

- Storage key: `hamfinder.selection.v1`. Value: `{ "states": string[], "items": [{ "type": "zip"|"county", "id": string, "label": string }] }`.
- Every storage call is in `try/catch`. Any error means "start empty" on load and "do nothing" on save.
- No framework, bundler, or build step. Nothing loads from third-party servers.
- Removing a state keeps its ZIPs and counties (same as today). "Clear all" clears picks only, not states.
- Step 2 filters, the view, and the map mode are not saved.
- WCAG 2.2 AA stays intact. `npm test` and `npm run lint` pass.

## Review Focus

1. **State list fails to load on start** (first visit while data is still loading, 503). Saved states must not be thrown away and overwritten with `[]`. They wait and are added when `reloadStates()` succeeds. Pinned by the `splitSavedStates` tests in Task 1 and the handling in Task 3.
2. **A saved state no longer exists** in `getStates()`. Skip it. Pinned in Task 1.
3. **`setItem` throws** (quota full, blocked storage). `save` returns quietly. Pinned in Task 1.
4. **Malformed saved items** (missing `id`, unknown `type`, duplicates, non-array). Skip the bad ones and keep the good ones. Pinned in Tasks 1 and 2.
5. **Saving during restore** would write a half state. The save listener is attached only after restore. Checked by hand in Task 3.

---

### Task 1: `saved-selection.js` load, save, and state filter

**Files:**
- Create: `public/js/saved-selection.js`
- Test: `tests/public/saved-selection.test.js`

**Interfaces:**
- Produces:
  - `export const STORAGE_KEY = 'hamfinder.selection.v1'`
  - `export function load(storage): { states: string[], items: Array<{type, id, label}> }`. `storage` is any object with `getItem`. It may be `undefined`/`null`.
  - `export function save(storage, { states, items }): void`
  - `export function splitSavedStates(saved: string[], known: string[]): { known: string[], unknown: string[] }`. Keeps saved order and drops duplicates.

- [ ] **Step 1: Write the failing tests** with a fake storage `{ data: {}, getItem(k) { return this.data[k] ?? null }, setItem(k, v) { this.data[k] = String(v) } }`:
  - `load returns empty when nothing is saved` → `{ states: [], items: [] }`
  - `save then load round-trips states and items` (MT, ID; one zip, one county)
  - `load returns empty for bad JSON` (`'{not json'`)
  - `load returns empty when getItem throws`, and also when `storage` is `undefined`
  - `load returns empty for wrong shape` (`'[]'`, `'null'`, `'{"states":"MT"}'`)
  - `load drops bad items and keeps good ones`: input items `[{type:'zip',id:'59801',label:'59801'}, {type:'zip'}, {type:'city',id:'x',label:'x'}, 'junk', {type:'zip',id:'59801',label:'59801'}]` → one item. A missing or non-string `label` falls back to `id`.
  - `load drops non-string states`
  - `save ignores setItem that throws` (does not throw)
  - `splitSavedStates keeps known in saved order and lists unknown`: `(['ID','XX','MT','ID'], ['MT','ID'])` → `{ known: ['ID','MT'], unknown: ['XX'] }`

- [ ] **Step 2: Run** `node --test tests/public/saved-selection.test.js`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the four exports. No browser globals in this file, so node can test it.

- [ ] **Step 4: Run** `node --test tests/public/saved-selection.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: save and load step 1 picks in localStorage (#2)`

### Task 2: `selection.restore(items)`

**Files:**
- Modify: `public/js/selection.js`
- Test: `tests/public/selection.test.js`

**Interfaces:**
- Produces: `selection.restore(items: Array<{type, id, label}>): void`. It replaces all current picks and fires change listeners exactly once. Items without a string `type` and `id` are skipped. Later duplicates are ignored.

- [ ] **Step 1: Write the failing tests:**
  - `restore replaces picks and fires one change event`: pick `zip:1`, then `restore([{zip 59801}, {county 30063 'Missoula, MT'}])`. The listener count goes up by 1. `items()` equals the two restored items in order. `has('zip','1')` is false.
  - `restore skips items without type or id`

- [ ] **Step 2: Run** `node --test tests/public/selection.test.js`. Expected: FAIL (`restore is not a function`).

- [ ] **Step 3: Implement** `restore` in `createSelection()`.

- [ ] **Step 4: Run** `node --test tests/public/selection.test.js`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: add selection.restore for one-event refill (#2)`

### Task 3: Restore on start and save on change in `step-areas.js`

**Files:**
- Modify: `public/js/step-areas.js`
- Modify: `docs/accessibility.md` (add one line under what was checked)

**Interfaces:**
- Consumes: `load`, `save`, `splitSavedStates` from Task 1. `selection.restore` from Task 2.

- [ ] **Step 1: Wire it up in `initAreas`:**
  - Get storage safely: `let storage; try { storage = window.localStorage; } catch { storage = null; }`.
  - Keep `let pendingStates = []` for saved states that wait for the state list.
  - `persist()` calls `save(storage, { states: [...picked, ...pendingStates], items: selection.items() })`.
  - After the first `loadStates()` and before the final `renderChips()`/`renderSelected()`: `const saved = load(storage)`, `selection.restore(saved.items)`, then `pendingStates = saved.states`, then call `addPendingStates()`.
  - `addPendingStates()`: if `states` is empty (state list failed), return and keep `pendingStates`. Otherwise use `splitSavedStates(pendingStates, states.map(s => s.abbr))`. Push the known ones not already in `picked`. Set `pendingStates = []`. If anything was added, call `statesChanged()`.
  - Call `addPendingStates()` at the end of a successful `loadStates()` too, so `reloadStates()` after a data update adds them.
  - Attach `selection.onChange(persist)` only after the restore. Call `persist()` at the end of `statesChanged()`.
  - "Clear all" needs no change. Its `selection.clear()` fires change, so `persist()` runs.

- [ ] **Step 2: Run** `npm test && npm run lint`. Expected: all pass.

- [ ] **Step 3: Check in a real browser** (`npm start`). Use scenarios 1 to 6 from the design talk: add MT, pick 3 counties, reload → back. Add ID, pick 2 ZIPs, reload → MT, ID, and 5 picks. Remove 1 county and 1 ZIP, reload → 3 picks. Remove ID, reload → ID chip gone and its ZIP still listed. Clear all, reload → MT and no picks. Put `{bad` in the key by hand, reload → empty page, no console errors. Check that focus and live messages did not change.

- [ ] **Step 4: Update** `docs/accessibility.md` with one line: reload with saved picks puts back chips and list, and focus and live messages are unchanged.

- [ ] **Step 5: Commit** `feat: remember step 1 picks between visits (#2)`
