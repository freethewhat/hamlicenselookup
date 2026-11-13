// Ids for focus handling. Each step's <h2> gets focus when the step opens.
export const stepHeadingId = (n) => `step-${n}-title`;

// Index of the chip button to focus after removing the chip at `removed`, with `remaining` chips left.
// The chip that slid into its place, or the new last one; -1 when none are left.
export const focusIndexAfterRemove = (removed, remaining) => (remaining === 0 ? -1 : Math.min(removed, remaining - 1));
