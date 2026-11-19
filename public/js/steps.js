// Step rules for the step bar and browser history. No browser APIs: testable under node.

// Step 1 is always open. Steps 2 and 3 need at least one picked area.
export const canEnterStep = (n, hasSelection) => n === 1 || hasSelection;

// The step stored in a history entry, or 1 when the entry has none (first page load, bad state).
export const stepFromState = (state) => ([1, 2, 3].includes(state?.step) ? state.step : 1);
