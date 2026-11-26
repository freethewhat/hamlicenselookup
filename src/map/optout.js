// Opt-out list: call signs that must never appear on the map. One per line, "#" starts a comment.
import { readFileSync, statSync } from 'node:fs';

export function parseOptOut(text) {
  const calls = new Set();
  for (const line of String(text).split('\n')) {
    const call = line.replace(/#.*/, '').trim().toUpperCase();
    if (call) calls.add(call);
  }
  return calls;
}

// Re-reads the file only when its mtime changes. A missing file is an empty list.
export function createOptOut(path) {
  let mtimeMs = null;
  let cached = new Set();
  return {
    calls() {
      let stamp;
      try {
        stamp = statSync(path).mtimeMs;
      } catch {
        mtimeMs = null;
        cached = new Set();
        return cached;
      }
      if (stamp !== mtimeMs) {
        cached = parseOptOut(readFileSync(path, 'utf8'));
        mtimeMs = stamp;
      }
      return cached;
    },
  };
}
